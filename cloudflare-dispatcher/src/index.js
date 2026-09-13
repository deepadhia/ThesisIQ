const GITHUB_OWNER = "deepadhia";
const GITHUB_REPO  = "thesisiq";
const GITHUB_REF   = "main";

// Schedule map containing HH:MM UTC times, their target workflows, and whether they allow Sunday execution.
const SCHEDULE = {
  "03:00": { workflows: ["remind-results.yml"],     allowSunday: true  },
  "03:30": { workflows: ["scan-announcements.yml"], allowSunday: false },
  "05:30": { workflows: ["scan-announcements.yml"], allowSunday: false },
  "08:00": { workflows: ["scan-announcements.yml"], allowSunday: false },
  "10:00": { workflows: ["scan-announcements.yml"], allowSunday: false },
  "14:30": { workflows: ["scan-announcements.yml"], allowSunday: false }, // 8:00 PM IST (late evening sweep)
  "16:30": { workflows: ["scan-announcements.yml"], allowSunday: false }, // 10:00 PM IST (late night sweep)
};

async function dispatchWorkflow(env, workflowFile, inputs = {}) {
  const owner = env.GITHUB_OWNER || GITHUB_OWNER;
  const repo  = env.GITHUB_REPO || GITHUB_REPO;
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`;
  const token = env.GITHUB_PAT || env.GITHUB_TOKEN || env.DEEPADHIA_GITHUB_TOKEN;
  if (!token) {
    throw new Error("Missing GITHUB_PAT (or GITHUB_TOKEN) secret in Cloudflare environment");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cloudflare-dispatcher-worker"
    },
    body: JSON.stringify({
      ref: GITHUB_REF,
      inputs: inputs
    })
  });

  if (response.status !== 204) {
    const errorText = await response.text();
    throw new Error(`GitHub API returned status ${response.status}: ${errorText}`);
  }
}

export default {
  async scheduled(event, env, ctx) {
    console.log(`Scheduled trigger fired for cron: "${event.cron}", scheduledTime: ${event.scheduledTime}`);

    let workflows = [];
    
    // Parse scheduledTime (or fallback to current time) to match exact HH:MM in UTC
    const date = new Date(event.scheduledTime || Date.now());
    const utcHours = String(date.getUTCHours()).padStart(2, "0");
    const utcMinutes = String(date.getUTCMinutes()).padStart(2, "0");
    const timeKey = `${utcHours}:${utcMinutes}`;
    const utcDay = date.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.

    console.log(`Time evaluation: timeKey="${timeKey}", utcDay=${utcDay}`);
    
    const slot = SCHEDULE[timeKey];
    if (slot) {
      if (utcDay === 0 && !slot.allowSunday) {
        console.log(`Skipping Sunday execution for slot ${timeKey}`);
        return;
      }
      workflows = slot.workflows;
    }

    if (workflows.length === 0) {
      console.log(`No workflows mapped/found to execute for this slot (no-op scheduled time).`);
      return;
    }

    for (const workflow of workflows) {
      ctx.waitUntil(
        dispatchWorkflow(env, workflow)
          .then(() => console.log(`Successfully dispatched workflow: ${workflow}`))
          .catch(err => console.error(`Failed to dispatch workflow ${workflow}:`, err.message))
      );
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Endpoint to manually trigger a workflow
    if (url.pathname === "/trigger") {
      const workflow = url.searchParams.get("workflow");
      if (!workflow) {
        return new Response(JSON.stringify({ ok: false, error: "Missing 'workflow' query parameter" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Check request method
      if (request.method !== "POST" && request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      try {
        console.log(`Manually dispatching workflow ${workflow} via HTTP request`);
        await dispatchWorkflow(env, workflow);
        return new Response(null, { status: 204 }); // Return 204 No Content like GitHub API
      } catch (err) {
        console.error(`Manual dispatch failed:`, err.message);
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Default healthcheck response
    return new Response(
      JSON.stringify({
        ok: true,
        message: "ThesisIQ Workflow Dispatcher is healthy",
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        ref: GITHUB_REF
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
};
