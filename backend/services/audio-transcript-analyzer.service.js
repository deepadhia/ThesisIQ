import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import { execFile } from "child_process";
import { promisify } from "util";
import { getGeminiModelNames, runLlm } from "./llm.service.js";

const execFileAsync = promisify(execFile);

// Helper to find ffmpeg on system (FFMPEG_PATH, a known local install, then PATH). Exported so the deploy smoke check tests the SAME binary the pipeline will use.
export function getFfmpegPath() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  const knownPaths = [
    "C:\\Users\\DeepJAdhia\\AppData\\Local\\Cypress\\Cache\\12.17.4\\Cypress\\resources\\app\\node_modules\\@ffmpeg-installer\\win32-x64\\ffmpeg.exe",
    "C:\\Users\\DeepJAdhia\\AppData\\Local\\Cypress\\Cache\\12.13.0\\Cypress\\resources\\app\\node_modules\\@ffmpeg-installer\\win32-x64\\ffmpeg.exe"
  ];
  for (const p of knownPaths) {
    if (fs.existsSync(p)) return p;
  }
  return "ffmpeg"; // fallback to PATH
}

/** A link that joins or registers for a LIVE call (Zoom webinar / meeting, Teams, Google Meet): never a recording. */
function isJoiningLink(url) {
  return /zoom\.us\/(?:webinar\/register|meeting\/register|j\/|my\/|s\/)|teams\.microsoft\.com\/l\/meetup-join|teams\.live\.com\/meet|meet\.google\.com\/[a-z]|webex\.com\/(?:meet|join|webappng)/i.test(String(url || ""));
}

/**
 * Extracts candidate media or webcast URLs from filing PDF text or attachment URL.
 */
export function extractAudioUrlFromFiling(pdfText = "", attachmentUrl = "") {
  // Reconnect URLs wrapped across line breaks in PDF layout (e.g. "https://example.com/path-\nsubpath" or "https://example.com/path/\nsubpath")
  // The next line continues the link only when it is the rest of the link: the WHOLE line, or a piece that looks like part of a
  // URL (it holds a dot, slash or query character). A plain word that starts a sentence ("Once registered, ...") is not a
  // continuation: POLICYBZR's Zoom link was glued to "Once" and sent to the downloader as an "audio" URL (404).
  const isLinkRest = (rest, after) => /^[a-zA-Z0-9_\-\.\/?&=%#]+$/.test(rest) && (/[.\/?&=%#]/.test(rest) || /^[ \t]*(?:\r?\n|$)/.test(after));
  const unwrappedText = (pdfText || "")
    .replace(/(https?:\/\/[^\s"'<>]+)-\r?\n([a-zA-Z0-9_\-\.\/?&=%#]+)(?=([\s\S]{0,3}))/gi, (match, p1, p2, after) => (isLinkRest(p2, after) ? `${p1}-${p2}` : match))
    .replace(/(https?:\/\/[^\s"'<>\-]+)\r?\n([a-zA-Z0-9_\-\.\/?&=%#]+)(?=([\s\S]{0,3}))/gi, (match, p1, p2, after) => {
      if (/\.(?:html?|pdf|php|aspx?)$/i.test(p1)) return match;
      if (isLinkRest(p2, after) && !/^(To|From|Dear|Date|Subject|The|Ref|Yours|For|National|BSE|NSE|You|Please|Kindly|With)\b/i.test(p2)) {
        return `${p1}${p2}`;
      }
      return match;
    });

  const combined = `${attachmentUrl}\n${unwrappedText}`;
  
  // 1. Look for direct audio/video links
  const directMatch = combined.match(/https?:\/\/[^\s"'<>]+\.(?:mp3|mp4|m4a|wav|aac|ogg)(?:\?[^\s"'<>]*)?/i);
  if (directMatch) return directMatch[0].replace(/[.,;)\]]+$/, "");

  // 1b. A media link printed WITHOUT "https://" ("...available on the website of the Company at sjsindia.com/Docs/Q2/call.mp3").
  // Only a host + path ending in a media extension counts; a bare website or an e-mail address never does.
  const bareMatch = unwrappedText.match(/(?<![\w@/.-])((?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s"'<>]*\.(?:mp3|mp4|m4a|wav|aac|ogg))(?![\w])/i);
  if (bareMatch) return `https://${bareMatch[1].replace(/[.,;)\]]+$/, "")}`;

  // 2. Look for common Indian corporate audio hosting, IR short links, or webcast links
  const webcastMatch = [...combined.matchAll(/https?:\/\/(?:www\.)?(?:[a-zA-Z0-9-]+\.)*(?:researchbytes|choruscall|orientcapital|zoom|webex|youtube|youtu\.be|drive\.google|dropbox|vimeo|tinyurl|bit\.ly|diamondpass)[^\s"'<>]+/gi)]
    .map((m) => m[0].replace(/[.,;)\]]+$/, ""))
    .find((u) => !isJoiningLink(u));
  if (webcastMatch) return webcastMatch;

  // 3. Look for generic URLs containing audio/concall/recording/webcast/transcript/investor pathways
  const genericAudioMatch = [...combined.matchAll(/https?:\/\/[^\s"'<>]+\/(?:audio|concall|recording|webcast|media|transcript|investor)[^\s"'<>]*/gi)]
    .map((m) => m[0].replace(/[.,;)\]]+$/, ""))
    .find((u) => !isJoiningLink(u));
  if (genericAudioMatch) return genericAudioMatch;

  // 4. In explicit audio intimation notices, capture any non-exchange corporate landing URL mentioned in the letter
  const isAudioNotice = /(?:audio recording|recording link|audio link|conference call recording|concall recording)/i.test(pdfText || "");
  if (isAudioNotice) {
    const allUrls = [...unwrappedText.matchAll(/https?:\/\/[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}[^\s"'<>]+/gi)]
      .map(m => m[0].replace(/[.,;)\]]+$/, ""))
      .filter(u => !/(?:nseindia\.com|bseindia\.com|bse\.com|w3\.org|adobe\.com)/i.test(u) && !isJoiningLink(u));
    if (allUrls.length > 0) return allUrls[0];
  }

  return null;
}

/**
 * Resolves an audio URL or HTML landing page into its underlying media stream, YouTube link, or webcast URL.
 */
export async function resolveAudioMediaUrl(url, { fetchFn = fetch, timeoutMs = 6000 } = {}) {
  if (!url || typeof url !== "string") return null;

  // Direct media extensions
  if (/\.(?:mp3|mp4|m4a|wav|aac|ogg)(?:\?[^\s"'<>]*)?$/i.test(url)) {
    return { type: "DIRECT_AUDIO", url };
  }

  // Direct YouTube links
  if (/(?:youtube\.com\/watch\?v=|youtu\.be\/)/i.test(url)) {
    return { type: "YOUTUBE", url };
  }

  // Web landing page: inspect HTML to harvest underlying media/webcast links
  try {
    const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined;
    const res = await fetchFn(url, {
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!res.ok) return { type: "WEB_LINK", url };

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html")) {
      return { type: "DIRECT_AUDIO", url };
    }

    const html = await res.text();

    // 1. Check for YouTube links in HTML
    const ytMatch = html.match(/(?:href|src)=["'](https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[a-zA-Z0-9_\-]+|youtu\.be\/[a-zA-Z0-9_\-]+)[^"']*)["']/i);
    if (ytMatch) {
      return { type: "YOUTUBE", url: ytMatch[1], originalUrl: url };
    }

    // 2. Check for direct audio files in HTML
    const audioMatch = html.match(/(?:href|src)=["']([^"']+\.(?:mp3|m4a|wav|aac|ogg)(?:\?[^"']*)?)["']/i);
    if (audioMatch) {
      const resolved = new URL(audioMatch[1], url).href;
      return { type: "DIRECT_AUDIO", url: resolved, originalUrl: url };
    }

    // 3. Check for ChorusCall / Researchbytes / Zoom / Drive in HTML
    const webcastMatch = html.match(/(?:href|src)=["'](https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:choruscall|researchbytes|orientcapital|drive\.google|dropbox|vimeo|zoom)[^"']*)["']/i);
    if (webcastMatch) {
      return { type: "WEBCAST", url: webcastMatch[1], originalUrl: url };
    }

    return { type: "LANDING_PAGE", url };
  } catch (err) {
    console.warn(`[AUDIO RESOLVER] Could not inspect landing page ${url}:`, err.message);
    return { type: "WEB_LINK", url };
  }
}

const MEDIA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

/**
 * GET a media URL. Node's fetch (undici) refuses some company web servers (odd response headers, TLS quirks) with a bare
 * "fetch failed" (INOXINDIA's recording was dead-lettered that way): retry once with the https module, which is more tolerant.
 */
async function fetchMedia(url) {
  try {
    return await fetch(url, { headers: { "User-Agent": MEDIA_UA } });
  } catch (primaryErr) {
    console.warn(`[AUDIO ANALYZER] fetch() failed for ${url} (${primaryErr.cause?.code || primaryErr.message}); retrying with the https module.`);
    const body = await new Promise((resolve, reject) => {
      const target = new URL(url);
      const lib = target.protocol === "http:" ? http : https;
      const req = lib.get(target, { headers: { "User-Agent": MEDIA_UA }, insecureHTTPParser: true, timeout: 60000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve({ redirect: new URL(res.headers.location, target).href });
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, statusText: res.statusMessage || "", headers: res.headers, buffer: Buffer.concat(chunks) }));
        res.on("error", reject);
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
    }).catch((fallbackErr) => { throw new Error(`fetch failed: ${primaryErr.cause?.code || primaryErr.message}; https fallback: ${fallbackErr.message}`); });
    if (body.redirect) return fetchMedia(body.redirect);
    return {
      ok: body.status >= 200 && body.status < 300,
      status: body.status,
      statusText: body.statusText,
      headers: { get: (k) => body.headers[String(k).toLowerCase()] || null },
      arrayBuffer: async () => body.buffer.buffer.slice(body.buffer.byteOffset, body.buffer.byteOffset + body.buffer.byteLength)
    };
  }
}

/**
 * Downloads media from URL and converts/extracts lightweight MP3 audio using ffmpeg.
 */
export async function downloadAndExtractMp3(url, outputMp3Path) {
  const tempDownloadPath = outputMp3Path.replace(/\.mp3$/i, "_raw.tmp");
  
  console.log(`[AUDIO ANALYZER] Downloading media stream from: ${url}`);
  const response = await fetchMedia(url);

  if (!response.ok) {
    throw new Error(`Failed to download audio stream: ${response.status} ${response.statusText}`);
  }

  // Handle HTML landing pages (e.g. company IR pages hosting the audio file)
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) {
    console.log(`[AUDIO ANALYZER] Detected HTML landing page for media URL. Resolving direct audio stream link...`);
    const resolved = await resolveAudioMediaUrl(url);
    if (resolved?.type === "DIRECT_AUDIO" && resolved.url !== url) {
      console.log(`[AUDIO ANALYZER] Successfully resolved direct audio stream: ${resolved.url}`);
      return downloadAndExtractMp3(resolved.url, outputMp3Path);
    }
    if (resolved?.type === "YOUTUBE") {
      throw new Error(`YOUTUBE_MEDIA_LINK:${resolved.url}`);
    }
    throw new Error(`Landing page did not contain direct audio link (.mp3/.m4a): ${url}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(tempDownloadPath, Buffer.from(arrayBuffer));

  const ffmpeg = getFfmpegPath();
  console.log(`[AUDIO ANALYZER] Extracting MP3 using ffmpeg (${ffmpeg})...`);

  try {
    // Speech needs 16 kHz mono, not music quality. A call re-encoded at -q:a 4 (~130 kbps) is ~60 MB per hour, far above the
    // 25 MB limit of the Whisper endpoint, so every hour-long call silently fell back to the slower, weaker audio analysis.
    // 32 kbps mono is ~14 MB per hour and transcribes just as well.
    await execFileAsync(ffmpeg, [
      "-i", tempDownloadPath,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-acodec", "libmp3lame",
      "-b:a", "32k",
      outputMp3Path,
      "-y"
    ]);
  } finally {
    if (fs.existsSync(tempDownloadPath)) {
      try { fs.unlinkSync(tempDownloadPath); } catch (_) {}
    }
  }

  if (!fs.existsSync(outputMp3Path) || fs.statSync(outputMp3Path).size === 0) {
    throw new Error("FFmpeg failed to generate MP3 file");
  }

  const sizeMb = (fs.statSync(outputMp3Path).size / (1024 * 1024)).toFixed(2);
  console.log(`[AUDIO ANALYZER] MP3 ready at ${outputMp3Path} (${sizeMb} MB)`);
  return outputMp3Path;
}

/** The Whisper endpoint rejects bodies above 25 MB; stay under it with headroom. */
export const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
const WHISPER_SEGMENT_SECONDS = 1200;

/** Splits a long recording into 20-minute pieces (stream copy, no re-encode) and returns the piece paths in order. */
async function splitAudioForWhisper(mp3Path) {
  const ffmpeg = getFfmpegPath();
  const dir = path.dirname(mp3Path);
  const base = path.basename(mp3Path, path.extname(mp3Path));
  const pattern = path.join(dir, `${base}_part%03d.mp3`);
  await execFileAsync(ffmpeg, ["-i", mp3Path, "-f", "segment", "-segment_time", String(WHISPER_SEGMENT_SECONDS), "-c", "copy", pattern, "-y"]);
  return fs.readdirSync(dir).filter((f) => f.startsWith(`${base}_part`) && f.endsWith(".mp3")).sort().map((f) => path.join(dir, f));
}

async function transcribeOnePiece(filePath, apiKey, timeoutMs) {
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer], { type: "audio/mp3" });
  const form = new FormData();
  form.append("file", blob, path.basename(filePath));
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "json");
  form.append("temperature", "0.0");
  // Company names, units and ratios are spelled the Indian-market way; a prompt steers the spelling of numbers and terms.
  form.append("prompt", "Indian company earnings conference call. Figures in rupees crore, EBITDA, PAT, YoY, QoQ, basis points, FY27, Q2.");

  const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined;
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    signal,
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: form
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq Whisper failed: ${res.status} ${errText}`);
  }
  const data = await res.json();
  return data.text || "";
}

/**
 * Fast transcription of an audio file with Groq's whisper-large-v3-turbo. A recording above the endpoint's 25 MB limit is
 * split into 20-minute pieces that are transcribed in order and joined.
 */
/**
 * The Groq key for Whisper. The server's key is GROQ_API_KEY; the worker used to look only at GROK_API_KEY (a name that is
 * otherwise just an alias, and that may hold an xAI "xai-" key), so on a server configured with GROQ_API_KEY alone Whisper
 * never ran and every call went to the thinner Gemini audio path. Read at call time so a changed environment is honoured.
 */
export function getWhisperApiKey(env = process.env) {
  const groq = String(env.GROQ_API_KEY || "").trim();
  if (groq) return groq;
  const alias = String(env.GROK_API_KEY || "").trim();
  return alias.startsWith("gsk_") ? alias : "";
}

export async function transcribeAudioWithGroqWhisper(mp3Path, { apiKey = getWhisperApiKey(), timeoutMs = 90000 } = {}) {
  if (!apiKey) throw new Error("GROK_API_KEY is not configured for Whisper transcription (set GROQ_API_KEY)");
  if (!fs.existsSync(mp3Path)) throw new Error(`Audio file not found at ${mp3Path}`);

  if (fs.statSync(mp3Path).size <= WHISPER_MAX_BYTES) return transcribeOnePiece(mp3Path, apiKey, timeoutMs);

  const pieces = await splitAudioForWhisper(mp3Path);
  if (pieces.length === 0) throw new Error("Could not split the recording for transcription");
  const texts = [];
  try {
    for (const piece of pieces) texts.push(await transcribeOnePiece(piece, apiKey, timeoutMs));
  } finally {
    for (const piece of pieces) { try { fs.unlinkSync(piece); } catch (_) { /* best-effort cleanup */ } }
  }
  return texts.join("\n");
}

/**
 * Uploads an MP3 file to Gemini File API and waits for ACTIVE state.
 */
async function uploadToGeminiFileApi(mp3Path, apiKey) {
  const stats = fs.statSync(mp3Path);
  const fileSize = stats.size;

  const initRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(fileSize),
      "X-Goog-Upload-Header-Content-Type": "audio/mp3",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      file: {
        display_name: `concall_audio_${Date.now()}`
      }
    })
  });

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Gemini initiate upload failed: ${initRes.status} ${errText}`);
  }

  const uploadUrl = initRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Did not receive x-goog-upload-url from Gemini");

  const fileBuffer = fs.readFileSync(mp3Path);
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(fileSize),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize"
    },
    body: fileBuffer
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Gemini audio upload failed: ${uploadRes.status} ${errText}`);
  }

  const uploadData = await uploadRes.json();
  const fileUri = uploadData.file?.uri;
  const fileName = uploadData.file?.name;

  let state = uploadData.file?.state;
  while (state === "PROCESSING") {
    await new Promise(r => setTimeout(r, 2000));
    const checkRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`);
    if (checkRes.ok) {
      const checkData = await checkRes.json();
      state = checkData.state;
      if (state === "FAILED") throw new Error("Gemini audio indexing failed");
    }
  }

  return { fileUri, fileName };
}

/**
 * Executes a Gemini prompt with production model fallbacks.
 */
async function callGemini(contents, apiKey, { perModelMs = 45000, totalMs = 120000 } = {}) {
  // Models come from the discovered registry (fast models first), never a hard-coded list.
  // Every attempt is time-boxed: this analysis is optional follow-up work and must never hold the pipeline for minutes.
  const models = getGeminiModelNames();
  let lastErr = null;
  const deadline = Date.now() + totalMs;

  for (const model of models) {
    const msLeft = deadline - Date.now();
    if (msLeft < 5000) break;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        signal: AbortSignal.timeout(Math.min(perModelMs, msLeft)),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[GEMINI] Model ${model} returned ${res.status}: ${errText}`);
        lastErr = new Error(`${model} failed: ${res.status} ${errText}`);
        continue;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return { text, model };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error("All Gemini models exhausted");
}

/**
 * Stage 1: Ingest and analyze Concall / AGM audio.
 */
export async function analyzeAudioWithGemini(mp3Path, ticker, companyName, thesis = "") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  console.log(`[AUDIO ANALYZER] Uploading MP3 to Gemini for ${ticker}...`);
  const { fileUri } = await uploadToGeminiFileApi(mp3Path, apiKey);

  const prompt = `
You are a senior institutional Indian equity research analyst auditing an Earnings Conference Call / AGM audio recording for ${companyName} (${ticker}).
Investment Thesis Context: ${thesis || "High ROCE, strong capital allocation, prudent balance sheet."}

Listen carefully to the entire audio recording. Provide a rigorous, institutional analysis.

Return ONLY a valid JSON object with the following schema:
{
  "executive_summary": "High-level qualitative assessment of management commentary, tone, and strategic inflection points.",
  "sentiment": "Strongly Confident | Confident | Neutral | Cautious | Defensive",
  "catalysts": [
    "Concrete catalyst or positive driver explaining stock momentum or re-rating"
  ],
  "commitments": [
    {
      "statement": "Verbatim or precise paraphrased management guidance or commitment",
      "metric": "Revenue | EBITDA Margin | Volume | CapEx | Debt Reduction | Timeline",
      "target_value": "The target exactly as the speaker states it, with its unit (an amount, a percentage or range, or a stated qualitative commitment). Never invent a figure.",
      "guidance_scope": "QUARTERLY | ANNUAL | MULTI_YEAR | CAPEX_MILESTONE",
      "timeline": "The target quarter, fiscal year or year range exactly as the speaker states it (a single quarter for quarterly, one fiscal year for annual, a range of years for multi-year)",
      "status": "Pending"
    }
  ],
  "margin_and_cost_dynamics": "Management explanation of raw material costs, freight, and pass-through pricing mechanics.",
  "capacity_and_utilization": "Disclosed built capacity, current volume run-rate, and utilization targets.",
  "qa_highlights": [
    {
      "analyst_or_shareholder": "Name or Institution if identified",
      "question": "Core question asked",
      "management_answer": "Management response summary",
      "is_evasive_or_dodged": false
    }
  ],
  "investment_memo_markdown": "Full, beautifully formatted multi-section Markdown investment memo covering Valuation, Catalysts, Moat, Deleveraging Roadmap, and Confidence Verdict."
}
`;

  const contents = [
    {
      parts: [
        {
          file_data: {
            mime_type: "audio/mp3",
            file_uri: fileUri
          }
        },
        { text: prompt }
      ]
    }
  ];

  console.log(`[AUDIO ANALYZER] Generating institutional audio audit for ${ticker}...`);
  const { text } = await callGemini(contents, apiKey, { perModelMs: 90000, totalMs: 180000 }); // audio is the heavy case

  const cleanJson = text.replace(/^```json\s*|\s*```$/gi, "").trim();
  try {
    return JSON.parse(cleanJson);
  } catch (err) {
    console.warn("[AUDIO ANALYZER] JSON parse warning, returning structured fallback:", err.message);
    return {
      executive_summary: text.slice(0, 500),
      raw_output: text,
      commitments: []
    };
  }
}

/**
 * Stage 2: Ingest and analyze Written PDF Transcript.
 */
export async function analyzeTranscriptWithGemini(transcriptText, ticker, companyName, thesis = "") {
  const systemPrompt = `You are a senior institutional Indian equity research analyst analyzing the official written earnings call transcript for ${companyName} (${ticker}). Return ONLY a valid JSON object.`;
  const userPrompt = `Investment Thesis Context: ${thesis || "High ROCE, strong capital allocation, prudent balance sheet."}

Filing Transcript Text:
${(transcriptText || "").substring(0, 80000)}

Return ONLY a valid JSON object:
{
  "executive_summary": "High-level summary of the written transcript",
  "guidance_numbers": {
    "quarterly_guidance": "Explicit guidance specifically for next quarter (e.g. Q2 revenue/margin) if mentioned, else 'None'",
    "annual_guidance": "Explicit guidance for full fiscal year (e.g. FY27 revenue/margin) if mentioned, else 'None'",
    "multi_year_targets": "Long term / Vision 2030 targets if mentioned, else 'None'",
    "capex_guidance": "Explicit capex guidance if mentioned, else 'None'"
  },
  "commitments": [
    {
      "statement": "Management commitment",
      "metric": "Operational | Financial",
      "target_value": "Specific target",
      "guidance_scope": "QUARTERLY | ANNUAL | MULTI_YEAR | CAPEX_MILESTONE",
      "timeline": "Target timeline",
      "status": "Pending"
    }
  ],
  "qa_topics": [
    {
      "question": "Question summary",
      "answer": "Answer summary",
      "dodged": false
    }
  ]
}
`;

  let replyText = "";
  try {
    replyText = await runLlm(systemPrompt, userPrompt, { temperature: 0.05, maxTotalMs: 90000 });
  } catch (llmErr) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw llmErr;
    console.warn(`[TRANSCRIPT ANALYZER] runLlm failed (${llmErr.message}), falling back to direct Gemini call...`);
    const contents = [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }];
    const { text } = await callGemini(contents, apiKey);
    replyText = text;
  }

  const cleanJson = (replyText || "").replace(/^```json\s*|\s*```$/gi, "").trim();
  try {
    return JSON.parse(cleanJson);
  } catch (err) {
    const match = cleanJson.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch { /* proceed to throw */ }
    }
    throw new Error(`Failed to parse transcript analysis JSON: ${err.message}`);
  }
}

/**
 * Cross-audit: Discrepancy detector between Audio Ingestion and Written Transcript.
 */
export async function auditDiscrepancies(audioData, transcriptData, ticker) {
  const systemPrompt = `You are an expert Forensic Auditor specializing in corporate disclosures under SEBI LODR regulations for ${ticker}. Return ONLY a valid JSON object.`;
  const userPrompt = `Compare the preliminary findings extracted from the LIVE CONCALL AUDIO against the OFFICIAL WRITTEN TRANSCRIPT published days later for ${ticker}.

Live Audio Findings:
${JSON.stringify(audioData, null, 2)}

Official Written Transcript Findings:
${JSON.stringify(transcriptData, null, 2)}

Tasks:
1. Detect any NUMERICAL DISCREPANCIES (e.g. guidance figures, capex numbers, or growth % mentioned in audio that differ in the written transcript).
2. Detect any SANITIZED / OMITTED STATEMENTS (e.g. sensitive questions about delays, competitors, or margins that management discussed in audio but were toned down, filtered, or excluded in the written transcript).
3. Determine if there is any MATERIAL DISCREPANCY that impacts investor confidence.

Return ONLY a valid JSON object:
{
  "has_material_discrepancy": true | false,
  "discrepancy_score": 1 to 10 (1 = identical match, 10 = massive contradiction / major sanitization),
  "summary_verdict": "Clear, concise 2-3 sentence forensic verdict",
  "discrepancies": [
    {
      "category": "NUMERICAL_MISMATCH | SANITIZED_COMMENT | OMITTED_QA | GUIDANCE_CHANGE",
      "audio_claim": "Exact quote or claim from audio",
      "written_transcript_claim": "How it was written in the transcript",
      "investor_implication": "Why this matters to shareholders"
    }
  ],
  "verification_status": "VERIFIED_CLEAN | MINOR_VARIATION | MATERIAL_DISCREPANCY_FLAGGED"
}
`;

  let replyText = "";
  try {
    replyText = await runLlm(systemPrompt, userPrompt, { temperature: 0.05, maxTotalMs: 90000 });
  } catch (llmErr) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw llmErr;
    console.warn(`[DISCREPANCY AUDITOR] runLlm failed (${llmErr.message}), falling back to direct Gemini call...`);
    const contents = [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }];
    const { text } = await callGemini(contents, apiKey);
    replyText = text;
  }

  const cleanJson = (replyText || "").replace(/^```json\s*|\s*```$/gi, "").trim();
  try {
    return JSON.parse(cleanJson);
  } catch (err) {
    const match = cleanJson.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch { /* proceed to throw */ }
    }
    throw new Error(`Failed to parse discrepancy audit JSON: ${err.message}`);
  }
}
