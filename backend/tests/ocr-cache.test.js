import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { ocrCacheKey, createOcrTextCache } from '../services/ocr-cache.service.js';

const GOOD = 'Statement of financial results. Revenue from operations and profit for the period. '.repeat(3);
describe('OCR content cache', () => {
  it('keys include content, prompt and image page order', () => {
    const a = Buffer.from('page-a'), b = Buffer.from('page-b');
    expect(ocrCacheKey({ bytes: a, prompt: 'statements' })).toBe(ocrCacheKey({ bytes: a, prompt: 'statements' }));
    expect(ocrCacheKey({ bytes: a, prompt: 'statements' })).not.toBe(ocrCacheKey({ bytes: b, prompt: 'statements' }));
    expect(ocrCacheKey({ bytes: a, prompt: 'statements' })).not.toBe(ocrCacheKey({ bytes: a, prompt: 'full' }));
    expect(ocrCacheKey({ images: [a,b], prompt: 'p' })).not.toBe(ocrCacheKey({ images: [b,a], prompt: 'p' }));
  });
  it('survives a new process instance, rejects corrupted/expired entries and never caches failures', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'thesisiq-cache-test-'));
    const key = ocrCacheKey({ bytes: Buffer.from('pdf'), prompt: 'p' });
    const now = Date.now();
    try {
      const cache = createOcrTextCache(root, { now: () => now });
      expect(await cache.get(key)).toBeNull();
      await cache.set(key, null);
      expect(await fs.readdir(root)).toEqual([]);
      await cache.set(key, GOOD);
      expect(await createOcrTextCache(root, { now: () => now+1 }).get(key)).toBe(GOOD);
      expect(await createOcrTextCache(root, { now: () => now+31*86400000 }).get(key)).toBeNull();
      const file = path.join(root, `${key}.json`);
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      await fs.writeFile(file, JSON.stringify({ ...data, text: GOOD+'wrong' }));
      expect(await cache.get(key)).toBeNull();
      await fs.writeFile(file, '{broken');
      expect(await cache.get(key)).toBeNull();
      expect((await fs.readdir(root)).filter(n => n.endsWith('.tmp'))).toEqual([]);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
