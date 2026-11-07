/**
 * Guards against a failure that happened more than once in this project: an edit made through a shell heredoc turns a regex
 * escape such as \b into a literal backspace character. The code still parses, the regex silently matches nothing, and a
 * safeguard (here: the name check on call highlights) stops working without any test noticing. Backend sources must contain no
 * control characters other than tab, newline and carriage return.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "fixtures") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(?:js|mjs|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("source hygiene", () => {
  it("no backend or script source contains a stray control character (a corrupted regex escape)", () => {
    const offenders = [];
    for (const dir of ["backend", "scripts"]) {
      const full = path.join(root, dir);
      if (!fs.existsSync(full)) continue;
      for (const f of walk(full)) {
        const text = fs.readFileSync(f, "utf8");
        const m = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.exec(text);
        if (m) offenders.push(`${path.relative(root, f)}:${text.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
