/**
 * Concall highlights: the prompt, the transcript splitting and the merge of per-part results (pure; the worker owns the LLM call).
 *
 * The reader's model of a good concall note (a hand-written one the user sent on 2026-11-05) has seven parts:
 *   1 guidance & outlook (including what CHANGED against earlier guidance)   2 quarterly numbers   3 business & segment
 *   4 capacity & capex   5 new initiatives & technology   6 risks & concerns   7 analyst take (what to monitor)
 * Earlier the model read only the first ~24k characters (about the first 40% of an hour-long call: prepared remarks) and was
 * never asked what changed, so a guidance CUT announced in the Q&A did not reach the alert. Long calls are now read in parts.
 */

import { dedupeNearDuplicates } from "./thesis-digest.service.js";

/** Lists a highlight block carries (the grounding guard and the formatter use the same names). */
export const HIGHLIGHT_LIST_FIELDS = [
  "guidance_changes", "quarterly_guidance", "annual_guidance", "multi_year_targets",
  "financial_performance", "business_performance", "operational_highlights", "growth_initiatives",
  "key_positives", "key_challenges", "key_monitorables"
];

/** Per-list caps after the parts are merged: a long call used to produce up to 18 bullets in one section. Order is kept (earliest first). */
const LIST_CAPS = { guidance_changes: 8, key_positives: 6, key_challenges: 8, key_monitorables: 6, growth_initiatives: 8 };

const MAX_PART_CHARS = 20000;
const MAX_PARTS = 3;
const MAX_TOTAL_CHARS = MAX_PART_CHARS * MAX_PARTS;

// ── Call structure: prepared remarks, then one exchange per analyst ──
// The moderator (or the host, when a call has none) introduces every analyst with a regular sentence: "We take the next question
// from the line of <name> from <firm>". Matched on 9 real calls (CCL, ELECON, GRAVITA, HSCL, JYOTICNC, LUMAXTECH, POLICYBZR,
// SHAKTIPUMP, SKIPPER): prepared remarks end 12-32% into the text, then 7-18 analysts follow. No model call is needed. The idea of
// splitting management commentary from per-analyst discussion comes from the MIT-licensed `concall-parser` (JS12540), which finds
// the moderator's intent with an LLM call per turn; plain pattern matching proved sufficient and is instant.
const QUESTION_CUE = /(?:first|next|another|following|last)\s+question\s+(?:is\s+|comes\s+)?from\s+(?:the\s+line\s+of\s+)?/gi;
const TURN_LABEL = /^[A-Za-z][A-Za-z.'\- ]{1,40}\s*:/;
const ANALYST_AFTER_CUE = /^(?:CA\s+|Mr\.?\s+|Ms\.?\s+|Mrs\.?\s+|Dr\.?\s+|Shri\s+)?([A-Z][A-Za-z.'-]*(?:\s+[A-Za-z.'-]+){0,3}?)\s*(?:,\s*(?:an?\s+)?|\s+(?:from|of|at|with)\s+)([^.]{2,70}?)(?:\.|\s+[Pp]lease)/;

/** Where the speaker turn that holds the cue starts: the label line ("Moderator: ...") at, or up to three lines above, the cue. */
function turnStart(t, idx) {
  let start = idx === 0 ? 0 : t.lastIndexOf("\n", idx - 1) + 1;
  const ownLine = start;
  for (let steps = 0; steps < 4; steps++) {
    const end = t.indexOf("\n", start);
    if (TURN_LABEL.test(t.slice(start, end === -1 ? t.length : end))) return start;
    if (start === 0) break;
    start = t.lastIndexOf("\n", start - 2) + 1;
  }
  return ownLine;
}

/**
 * @returns {{prepared: string, qa: null | Array<{analyst: string|null, company: string|null, text: string}>}}
 *   `qa` is null when the text has no analyst introductions (a monologue, a deck, a transcript with no moderator turns).
 *   prepared + every exchange's text rebuild the input exactly.
 */
export function segmentCall(text = "") {
  const t = String(text || "");
  const cues = [...t.matchAll(QUESTION_CUE)];
  if (!cues.length) return { prepared: t, qa: null };
  const starts = [];
  const info = [];
  for (const m of cues) {
    const s = turnStart(t, m.index);
    // The introduction is the host's: "...from the line of <name>", or any phrasing spoken in a Moderator / Operator / Host /
    // Management turn. An analyst's own "last question from my end" (CCL) is not one.
    const lineEnd = t.indexOf("\n", s);
    const label = /^([A-Za-z][A-Za-z.'\- ]{1,40})\s*:/.exec(t.slice(s, lineEnd === -1 ? t.length : lineEnd))?.[1] || "";
    if (!/the\s+line\s+of/i.test(m[0]) && !/^(?:moderator|operator|host|management|chair\w*|coordinator)$/i.test(label.trim())) continue;
    if (starts.length && s <= starts[starts.length - 1]) continue;   // two cues in one turn: one exchange
    starts.push(s);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 240).replace(/\s+/g, " ");
    const who = ANALYST_AFTER_CUE.exec(after);
    // "Ashwin Mehta. Ashwin, please unmute your mic" names no firm: the name ends at the sentence end, and a prompt is no company
    const name = who ? who[1].split(/\.\s/)[0].trim() : null;
    const company = who && !/unmute|go\s+ahead|your\s+mic|please/i.test(who[2]) && !/\.\s/.test(who[1]) ? who[2].trim() : null;
    info.push({ analyst: name, company });
  }
  const qa = starts.map((s, i) => ({ ...info[i], text: t.slice(s, i + 1 < starts.length ? starts[i + 1] : t.length) }));
  return { prepared: t.slice(0, starts[0]), qa };
}

/** Keeps the start and the end of a long passage (the question and the closing of the answer), cut at sentence ends where possible. */
function trimToChars(s, cap) {
  if (s.length <= cap) return s;
  const marker = " […] ";
  const headLen = Math.floor((cap - marker.length) * 0.45);
  const tailLen = cap - marker.length - headLen;
  let head = s.slice(0, headLen);
  const hs = head.search(/[.?!]\s[^.?!]*$/);
  if (hs > headLen * 0.7) head = head.slice(0, hs + 1);
  let tail = s.slice(s.length - tailLen);
  const ts = tail.search(/[.?!]\s/);
  if (ts !== -1 && ts < tailLen * 0.3) tail = tail.slice(ts + 2);
  return `${head.trimEnd()}${marker}${tail.trimStart()}`;
}

/** Cuts one long unit into pieces of at most `max` characters at sentence ends. */
function chunkBySentence(s, max) {
  const out = [];
  let rest = s;
  while (rest.length > max) {
    let end = max;
    const back = rest.slice(0, max).search(/[.?!]\s[^.?!]*$/);
    if (back > max * 0.6) end = back + 1;
    out.push(rest.slice(0, end).trim());
    rest = rest.slice(end);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

/** Parts that start at an exchange boundary; an over-long call is trimmed per exchange (every analyst stays), not chopped in the middle. */
function splitByStructure(seg) {
  const prepared = seg.prepared.trim();
  const exchanges = seg.qa.map((e) => e.text.trim());
  const total = prepared.length + exchanges.reduce((n, e) => n + e.length, 0);
  // As is when it fits; otherwise trim only the longest exchanges, a little more each time, until whole exchanges can be grouped.
  const ladder = total <= MAX_TOTAL_CHARS ? [null, 0.93, 0.85, 0.75] : [0.93, 0.85, 0.75];
  for (const factor of ladder) {
    const parts = groupIntoParts(factor === null ? prepared : trimPrepared(prepared), factor === null ? exchanges : trimExchanges(trimPrepared(prepared), exchanges, factor));
    if (parts) return parts;
  }
  return null;
}

function trimPrepared(prepared) {
  const cap = Math.floor(MAX_TOTAL_CHARS * 0.55);
  return prepared.length > cap ? trimToChars(prepared, cap) : prepared;
}

/** Water-filling: short exchanges keep all they have, the slack goes to the longest ones. */
function trimExchanges(prepared, exchanges, factor) {
  let remaining = Math.floor(MAX_TOTAL_CHARS * factor) - prepared.length;
  const order = exchanges.map((e, i) => i).sort((a, b) => exchanges[a].length - exchanges[b].length);
  const caps = new Array(exchanges.length);
  order.forEach((idx, k) => {
    const share = Math.max(600, Math.floor(remaining / (order.length - k)));
    caps[idx] = share;
    remaining -= Math.min(exchanges[idx].length, share);
  });
  return exchanges.map((e, i) => trimToChars(e, caps[i]));
}

/**
 * Groups whole units into n contiguous parts so that the LARGEST part is as small as possible (a greedy fill to the limit needs a
 * 4th part for a 55-60k call). About twenty units and at most three parts: an exact dynamic programme is instant.
 * Null when even the best grouping leaves a part over the limit.
 */
function groupIntoParts(prepared, exchanges) {
  const units = [prepared, ...exchanges].filter(Boolean).flatMap((u) => (u.length > MAX_PART_CHARS ? chunkBySentence(u, MAX_PART_CHARS) : [u]));
  const size = units.map((u) => u.length + 2);
  const sum = size.reduce((a, b) => a + b, 0);
  const n = Math.max(1, Math.min(MAX_PARTS, Math.ceil(sum / MAX_PART_CHARS)));
  const pre = [0];
  size.forEach((sz, i) => pre.push(pre[i] + sz));
  const m = units.length;
  const best = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  const cut = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  best[0][0] = 0;
  for (let k = 1; k <= n; k++) {
    for (let i = k; i <= m; i++) {
      for (let j = k - 1; j < i; j++) {
        const cost = Math.max(best[k - 1][j], pre[i] - pre[j]);
        if (cost < best[k][i]) { best[k][i] = cost; cut[k][i] = j; }
      }
    }
  }
  if (!(best[n][m] - 2 <= MAX_PART_CHARS)) return null;
  const parts = [];
  for (let k = n, i = m; k >= 1; k--) {
    const j = cut[k][i];
    parts.unshift(units.slice(j, i).join("\n\n"));
    i = j;
  }
  return parts;
}

/**
 * Splits a transcript into at most three parts. A call with analyst introductions is cut BETWEEN exchanges (prepared remarks first),
 * never inside an answer, and a call longer than three parts can hold is trimmed per exchange so every analyst stays. A text with
 * no structure is cut into parts of about equal size at sentence ends, keeping its beginning and its end.
 */
export function splitTranscript(text = "") {
  const t = String(text || "").trim();
  if (!t) return [];
  if (t.length <= MAX_PART_CHARS) return [t];
  const seg = segmentCall(t);
  if (seg.qa) {
    const parts = splitByStructure(seg);
    if (parts) return parts;
  }
  return splitEqually(t);
}

function splitEqually(input) {
  let t = input;
  if (t.length > MAX_TOTAL_CHARS) {
    const head = Math.floor(MAX_TOTAL_CHARS * 0.4);
    t = `${t.slice(0, head)}\n${t.slice(t.length - (MAX_TOTAL_CHARS - head))}`;
  }
  const n = Math.min(MAX_PARTS, Math.ceil(t.length / MAX_PART_CHARS));
  const target = Math.ceil(t.length / n);
  const parts = [];
  let start = 0;
  for (let i = 0; i < n - 1; i++) {
    let end = Math.min(t.length, start + target);
    const window = t.slice(end, Math.min(t.length, end + 600));
    const stop = window.search(/[.?!]\s/);
    if (stop !== -1) end += stop + 1;
    parts.push(t.slice(start, end).trim());
    start = end;
  }
  parts.push(t.slice(start).trim());
  return parts.filter(Boolean);
}

/** Prompts for one part of a call. Only abstract descriptors here (AGENTS.md rule 6): no names, no sample figures. */
export function buildHighlightPrompts({ ticker, companyName, text, partIndex = 0, partCount = 1, docKind = "call" }) {
  const isDoc = docKind === "presentation";
  const system = isDoc
    ? `You are a senior equity research analyst writing a structured presentation highlight report from a company's investor presentation or press release. You report ONLY what the document explicitly states: every figure you write must be printed in the document, with its unit and the comparison as printed. If the document gives no figure or says nothing on a topic, return an empty list for that section. Never estimate, round, infer, or reuse any number or name from these instructions. Write short, plain bullets (one fact each, at most 25 words), no filler.`
    : `You are a senior equity research analyst writing a structured concall highlight report from an earnings conference call transcript. You report ONLY what the transcript explicitly states: every figure you write must be printed in the transcript, with its unit and the comparison as spoken. If the call gives no figure or says nothing on a topic, return an empty list for that section. Never estimate, round, infer, or reuse any number or name from these instructions. Write short, plain bullets (one fact each, at most 25 words), no filler.`;
  const where = partCount > 1 ? `This is part ${partIndex + 1} of ${partCount} of the ${isDoc ? "document" : "call"}: report only what THIS part states.\n` : "";
  const user = `Company: ${companyName} (${ticker})
${where}${isDoc ? "Investor presentation / press release text" : "Earnings call transcript"}:
${text}

Extract these sections (and nothing else):
1. "guidance_changes": every change to earlier guidance or targets: say what the metric is, what it was before, what it is now, and whether it was RAISED, CUT or REAFFIRMED. Include a change management itself calls a revision or recalibration, and what management gave as the reason. [] if none.
2. "quarterly_guidance": explicit targets or milestones for the next quarter. State the business scope (company, segment or subsidiary) and timing exactly as given. [] if none.
3. "annual_guidance": explicit targets or commitments for the current or a future fiscal year, including revenue, growth, margin, volume, order execution or capex. State the business scope (company, segment or subsidiary) and fiscal year exactly; never present a segment target as company-wide guidance. [] if none.
4. "multi_year_targets": explicit longer-horizon targets or milestones, including a dated plan or a one-to-two-year goal that does not name a fiscal year. State the business scope and horizon exactly. [] if none.
5. "financial_performance": the revenue, EBITDA and margin, profit, order book, export or segment revenue, cash and return ratios management stated for the period, each with the comparison given.
6. "business_performance": customer wins, order sizes, segment or division and market-share performance, export performance, product mix.
7. "operational_highlights": capacity, utilisation, plant or facility start-up dates, capex amounts and how they are funded, acquisitions and integration.
8. "growth_initiatives": new products, technologies, partnerships, new facilities and the timeline management gave.
9. "key_positives": the main positive points made ${isDoc ? "in the document" : "on the call"} (at most 5).
10. "key_challenges": the risks, headwinds, cuts and weak segments management or analysts raised (at most 5).
11. "key_monitorables": what management or analysts said should be tracked next (at most 4).
12. "management_tone": the tone of management in 2-3 words.
13. "key_takeaway": one sentence bottom line that uses only facts stated ${isDoc ? "in the document" : "on the call"}, and says plainly if guidance was cut.

Rules: no placeholders (never write X, Y, Z or "details"); an empty list is the correct answer when this part is silent on a section.

Return ONLY a valid JSON object with exactly these keys:
{
  "guidance_changes": ["<metric>: <earlier> -> <now> (<raised|cut|reaffirmed>), <reason if stated>"],
  "quarterly_guidance": ["<as stated>"],
  "annual_guidance": ["<as stated>"],
  "multi_year_targets": ["<as stated>"],
  "financial_performance": ["<metric>: <figure with unit and comparison as stated>"],
  "business_performance": ["<as stated>"],
  "operational_highlights": ["<as stated>"],
  "growth_initiatives": ["<as stated>"],
  "key_positives": ["<as stated>"],
  "key_challenges": ["<as stated>"],
  "key_monitorables": ["<as stated>"],
  "management_tone": "<2-3 words>",
  "key_takeaway": "<one sentence>"
}`;
  return { system, user };
}

/** Parses the model's JSON reply for one part; null when it holds no object. */
export function parseHighlightReply(reply) {
  if (!reply || typeof reply !== "string") return null;
  const cleaned = reply.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = cleaned.indexOf("{");
  const b = cleaned.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) return null;
  try {
    return JSON.parse(cleaned.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** Union of the per-part results: lists are concatenated and near-duplicates dropped; the first usable tone / takeaway wins (later parts are Q&A, so a cut announced there wins over silence). */
export function mergeConcallHighlights(parts = []) {
  const usable = parts.filter((p) => p && typeof p === "object");
  if (usable.length === 0) return null;
  const out = {};
  for (const f of HIGHLIGHT_LIST_FIELDS) {
    const all = usable.flatMap((p) => (Array.isArray(p[f]) ? p[f].filter((x) => typeof x === "string") : []));
    out[f] = dedupeNearDuplicates(all).slice(0, LIST_CAPS[f] ?? 10);
  }
  const tones = usable.map((p) => p.management_tone).filter((t) => typeof t === "string" && t.trim().length >= 3);
  out.management_tone = tones[0] || null;
  // The takeaway of the last part that has one describes the whole call best only when it mentions a cut; otherwise the first.
  const takeaways = usable.map((p) => p.key_takeaway).filter((t) => typeof t === "string" && t.trim().length >= 10);
  out.key_takeaway = takeaways.find((t) => /\b(cut|reduc|lower|revis|recalibrat|downgrad)/i.test(t)) || takeaways[0] || null;
  out.management_guidance = [...out.quarterly_guidance, ...out.annual_guidance, ...out.multi_year_targets];
  return out;
}
