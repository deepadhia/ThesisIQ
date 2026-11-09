import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 1;
const MAX_AGE_MS = 30 * 86400000;

/** Exact input bytes, page order, prompt and schema version identify one transcription task. No key or URL is stored. */
export function ocrCacheKey({ bytes = null, images = null, prompt }) {
  const hash = crypto.createHash('sha256').update(`ocr-cache-${VERSION}\n${prompt}\n`);
  for (const part of images?.length ? images : [bytes]) {
    const data = Buffer.from(part);
    hash.update(String(data.length)).update(':').update(data);
  }
  return hash.digest('hex');
}

export function createOcrTextCache(root, { now = Date.now } = {}) {
  const target = key => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid OCR cache key');
    return path.join(root, `${key}.json`);
  };
  return {
    async get(key) {
      try {
        const entry = JSON.parse(await fs.readFile(target(key), 'utf8'));
        if (entry.version !== VERSION || entry.key !== key || typeof entry.text !== 'string' || entry.text.length <= 50 || entry.text.length > 60000) return null;
        if (!Number.isFinite(entry.createdAt) || entry.createdAt > now() || now() - entry.createdAt > MAX_AGE_MS) return null;
        if (crypto.createHash('sha256').update(entry.text).digest('hex') !== entry.textHash) return null;
        return entry.text;
      } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`[OCR CACHE] Ignoring unreadable cache entry: ${err.message}`);
        return null;
      }
    },
    async set(key, text) {
      if (typeof text !== 'string' || text.length <= 50 || text.length > 60000) return;
      const dest = target(key);
      const temp = `${dest}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.mkdir(root, { recursive: true });
        await fs.writeFile(temp, JSON.stringify({ version: VERSION, key, text, createdAt: now(), textHash: crypto.createHash('sha256').update(text).digest('hex') }));
        await fs.rename(temp, dest);
      } catch (err) {
        console.warn(`[OCR CACHE] Could not cache transcription: ${err.message}`);
        try { await fs.unlink(temp); }
        catch (cleanupErr) { if (cleanupErr.code !== 'ENOENT') console.warn(`[OCR CACHE] Could not remove temporary entry: ${cleanupErr.message}`); }
      }
    }
  };
}

const root = process.env.PDF_OCR_CACHE_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scratch/ocr-cache');
export const ocrTextCache = process.env.PDF_OCR_CACHE === 'off' ? null : createOcrTextCache(root);
