import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";

export const ALLOWED_CATEGORIES = new Set([
  "concall_transcript",
  "earnings_result",
  "investor_presentation",
]);

export function verifyOutput(dataDir) {
  const baseDir = dataDir || DATA_DIR;
  const lines = ["VERIFICATION REPORT (Node)", "-".repeat(50)];
  lines.push(`Checking: ${baseDir}`);
  if (!fs.existsSync(baseDir)) {
    lines.push("Folder not found. Run failed or was skipped.");
    return { ok: false, report: lines.join("\n") };
  }

  const bySymbolQuarter = new Map();
  const bad = [];
  let total = 0;

  for (const symbolName of fs.readdirSync(baseDir)) {
    const symbolDir = path.join(baseDir, symbolName);
    if (!fs.statSync(symbolDir).isDirectory()) continue;
    if (["download_log.json", "watcher_state.json"].includes(symbolName)) {
      continue;
    }

    for (const quarterName of fs.readdirSync(symbolDir)) {
      const quarterDir = path.join(symbolDir, quarterName);
      if (!fs.statSync(quarterDir).isDirectory()) continue;
      if (!quarterName.startsWith("FY")) continue;

      for (const file of fs.readdirSync(quarterDir)) {
        if (!file.toLowerCase().endsWith(".pdf")) continue;
        total += 1;
        const name = file;
        let cat = "unknown";
        if (name.includes("_")) {
          const parts = name.split("_");
          cat = parts.length >= 2 ? `${parts[0]}_${parts[1]}` : parts[0];
        }
        if (!ALLOWED_CATEGORIES.has(cat)) {
          bad.push(`${symbolName}/${quarterName}/${name} -> unknown category`);
        }

        const key = `${symbolName}|${quarterName}`;
        if (!bySymbolQuarter.has(key)) bySymbolQuarter.set(key, []);
        bySymbolQuarter.get(key).push(cat);
      }
    }
  }

  lines.push(`Total PDFs: ${total}`);

  if (bad.length > 0) {
    lines.push(`Unexpected files (not in allowed types): ${bad.length}`);
    for (const b of bad.slice(0, 10)) {
      lines.push(`  ${b}`);
    }
    if (bad.length > 10) {
      lines.push(`  ... and ${bad.length - 10} more`);
    }
  } else {
    lines.push(
      "All files are one of: concall_transcript, earnings_result, investor_presentation",
    );
  }

  lines.push("");
  lines.push("Per symbol / quarter (E=earnings, P=presentation, C=concall):");

  const sortedKeys = Array.from(bySymbolQuarter.keys()).sort();
  for (const key of sortedKeys) {
    const [symbol, quarter] = key.split("|");
    const cats = bySymbolQuarter.get(key);
    const e = cats.includes("earnings_result") ? "E" : "-";
    const p = cats.includes("investor_presentation") ? "P" : "-";
    const c = cats.includes("concall_transcript") ? "C" : "-";
    lines.push(`  ${symbol} ${quarter}:${e}${p}${c}`);
  }

  lines.push("");
  lines.push(
    "Legend: E=earnings result, P=investor presentation, C=concall transcript",
  );

  const ok = bad.length === 0 && total > 0;
  return { ok, report: lines.join("\n") };
}

function main() {
  const { ok, report } = verifyOutput();
  console.log(report);
  if (ok) {
    console.log(
      "OUTPUT IS PROPER (Node): All files in allowed categories, structure by symbol/quarter looks good.",
    );
  } else {
    console.log(
      "OUTPUT CHECK (Node): Review report above. Fix any failed steps or unexpected files and re-run if needed.",
    );
  }
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

