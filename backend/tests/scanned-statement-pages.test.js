import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { rankScannedTablePages } from '../services/scanned-statement-pages.service.js';

const fixture = (name) => fs.readFileSync(path.resolve('backend/tests/fixtures/real-layouts', name));

describe('scanned statement page selection', () => {
  it('locates both result tables in a real scanned results packet, putting the consolidated table first', async () => {
    const candidates = [
      {num: 2, image: fixture('inox-scanned-auditor-page.png')},
      {num: 3, image: fixture('inox-scanned-standalone-page.png')},
      {num: 4, image: fixture('inox-scanned-balance-page.png')},
      {num: 9, image: fixture('inox-scanned-consolidated-page.png')}
    ];
    expect(await rankScannedTablePages(candidates, 2)).toEqual([9, 3]);
  });
});
