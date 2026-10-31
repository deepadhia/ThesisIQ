import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { thesisContractCandidates, findThesisContractFile, THESIS_CONTRACT_DIR } from '../utils/thesis-contract-files.js';
import { loadThesisContracts, getThesisContract } from '../services/thesis-driver-context.service.js';

const FILES = ['driver-level-thesis-contracts.json', 'supplementary-thesis-contracts.json'];

describe('thesis contract files ship with the repo (reports/ is git-ignored and never reaches the server)', () => {
  it('the tracked directory is the first place looked in, and it is not under reports/', () => {
    for (const f of FILES) {
      const first = thesisContractCandidates(f)[0];
      expect(first).toBe(path.join(THESIS_CONTRACT_DIR, f));
      expect(first).not.toMatch(/[\\/]reports[\\/]/);
    }
  });

  it('both contract files exist in the tracked directory and are not matched by .gitignore', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    for (const f of FILES) {
      const full = path.join(THESIS_CONTRACT_DIR, f);
      expect(fs.existsSync(full), `${f} missing from the tracked directory`).toBe(true);
      const rel = path.relative(process.cwd(), full).replace(/\\/g, '/');
      for (const rule of rules) {
        if (rule.endsWith('/')) expect(rel.startsWith(rule), `${f} ignored by ${rule}`).toBe(false);
        else if (!rule.includes('*')) expect(rel, `${f} ignored by ${rule}`).not.toBe(rule);
      }
    }
  });

  it('a server that has ONLY the tracked files (a fresh git pull / GitHub checkout) still finds them', () => {
    const onlyTracked = (p) => p.startsWith(THESIS_CONTRACT_DIR);
    for (const f of FILES) expect(findThesisContractFile(f, { exists: onlyTracked })).toBe(path.join(THESIS_CONTRACT_DIR, f));
  });

  it('when both a tracked and a local reports/ copy exist, the tracked one wins (identical behaviour on every machine)', () => {
    const f = FILES[0];
    expect(findThesisContractFile(f, { exists: () => true })).toBe(path.join(THESIS_CONTRACT_DIR, f));
  });

  it('the legacy reports/ copy is still used when nothing is tracked yet', () => {
    const f = FILES[0];
    const found = findThesisContractFile(f, { exists: (p) => /[\\/]reports[\\/]/.test(p), cwd: process.cwd() });
    expect(found).toMatch(/reports/);
  });

  it('returns null when no copy exists anywhere', () => {
    expect(findThesisContractFile(FILES[0], { exists: () => false })).toBeNull();
  });

  it('the driver contracts load from the tracked files: every portfolio stock has drivers, including the hand-written provisional one', () => {
    const map = loadThesisContracts();
    expect(map.size).toBeGreaterThanOrEqual(19);
    for (const t of ['HBLENGINE', 'SHAKTIPUMP', 'GRAVITA', 'CCL', 'MOREPENLAB']) {
      expect(getThesisContract(t)?.drivers?.length, `${t} has no driver contract`).toBeGreaterThan(0);
    }
    expect(getThesisContract('MOREPENLAB').provisional).toBe(true);
  });
});
