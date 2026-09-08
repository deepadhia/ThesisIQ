import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Helper to find ffmpeg on system
function getFfmpegPath() {
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

/**
 * Extracts candidate media or webcast URLs from filing PDF text or attachment URL.
 */
export function extractAudioUrlFromFiling(pdfText = "", attachmentUrl = "") {
  const combined = `${attachmentUrl}\n${pdfText}`;
  
  // Look for direct audio/video links
  const directMatch = combined.match(/https?:\/\/[^\s"'<>]+\.(?:mp3|mp4|m4a|wav|aac)(?:\?[^\s"'<>]*)?/i);
  if (directMatch) return directMatch[0];

  // Look for common Indian corporate audio hosting / webcast links
  const webcastMatch = combined.match(/https?:\/\/(?:www\.)?(?:cclproducts|researchbytes|choruscall|zoom|webex|youtube|youtu\.be|drive\.google|dropbox|vimeo)[^\s"'<>]+/i);
  if (webcastMatch) return webcastMatch[0];

  return null;
}

/**
 * Downloads media from URL and converts/extracts lightweight MP3 audio using ffmpeg.
 */
export async function downloadAndExtractMp3(url, outputMp3Path) {
  const tempDownloadPath = outputMp3Path.replace(/\.mp3$/i, "_raw.tmp");
  
  console.log(`[AUDIO ANALYZER] Downloading media stream from: ${url}`);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download audio stream: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(tempDownloadPath, Buffer.from(arrayBuffer));

  const ffmpeg = getFfmpegPath();
  console.log(`[AUDIO ANALYZER] Extracting MP3 using ffmpeg (${ffmpeg})...`);

  try {
    // Fast audio extraction without video re-encoding
    await execFileAsync(ffmpeg, [
      "-i", tempDownloadPath,
      "-vn",
      "-acodec", "libmp3lame",
      "-q:a", "4",
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
async function callGemini(contents, apiKey) {
  // Use active 2026 high-throughput production models
  const models = ["gemini-flash-latest", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-lite-latest"];
  let lastErr = null;

  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
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
      "target_value": "Explicit numeric target (e.g. '₹10,000 Cr', '80-85% utilization', 'Zero net debt')",
      "timeline": "Explicit target quarter or fiscal year (e.g. 'FY31', 'FY28')",
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
  const { text } = await callGemini(contents, apiKey);

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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const prompt = `
You are a senior institutional Indian equity research analyst analyzing the official written earnings call transcript for ${companyName} (${ticker}).
Investment Thesis Context: ${thesis || "High ROCE, strong capital allocation, prudent balance sheet."}

Filing Transcript Text:
${transcriptText.substring(0, 100000)}

Return ONLY a valid JSON object:
{
  "executive_summary": "High-level summary of the written transcript",
  "guidance_numbers": {
    "revenue_guidance": "Explicit guidance if mentioned, else 'None'",
    "ebitda_margin_guidance": "Explicit margin guidance if mentioned, else 'None'",
    "volume_growth_guidance": "Explicit volume % guidance if mentioned, else 'None'",
    "capex_guidance": "Explicit capex guidance if mentioned, else 'None'"
  },
  "commitments": [
    {
      "statement": "Management commitment",
      "metric": "Operational | Financial",
      "target_value": "Specific target",
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

  const contents = [{ parts: [{ text: prompt }] }];
  const { text } = await callGemini(contents, apiKey);
  const cleanJson = text.replace(/^```json\s*|\s*```$/gi, "").trim();
  return JSON.parse(cleanJson);
}

/**
 * Cross-audit: Discrepancy detector between Audio Ingestion and Written Transcript.
 */
export async function auditDiscrepancies(audioData, transcriptData, ticker) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const prompt = `
You are an expert Forensic Auditor specializing in corporate disclosures under SEBI LODR regulations.
Compare the preliminary findings extracted from the LIVE CONCALL AUDIO against the OFFICIAL WRITTEN TRANSCRIPT published days later for ${ticker}.

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

  const contents = [{ parts: [{ text: prompt }] }];
  const { text } = await callGemini(contents, apiKey);
  const cleanJson = text.replace(/^```json\s*|\s*```$/gi, "").trim();
  return JSON.parse(cleanJson);
}
