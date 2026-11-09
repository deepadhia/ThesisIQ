import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const MAX_RETENTION_DAYS = 15;

/**
 * Ensures the logs directory exists.
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Automatically purges log files older than 15 days.
 */
function rotateOldLogs() {
  try {
    ensureLogDir();
    const files = fs.readdirSync(LOG_DIR);
    const now = Date.now();
    const maxAgeMs = MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    files.forEach(file => {
      if (file.startsWith('scanner-') && file.endsWith('.log')) {
        const filePath = path.join(LOG_DIR, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          console.log(`[LOGGER ROTATION] Purged 15-day old log file: ${file}`);
        }
      }
    });
  } catch (err) {
    console.error("[LOGGER ROTATION ERROR]", err.message);
  }
}

/**
 * Writes a timestamped log entry to both console stdout and daily log file (logs/scanner-YYYY-MM-DD.log).
 */
export function writeLog(tag, message, { persist = true } = {}) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = now.toISOString().replace('T', ' ').substring(0, 19);

  const formattedLine = `[${timeStr}] [${tag}] ${message}\n`;

  // 1. Log to console stdout
  console.log(`[${timeStr}] [${tag}] ${message}`);
  if (!persist) return;

  // 2. Write to daily log file
  try {
    ensureLogDir();
    const logFilePath = path.join(LOG_DIR, `scanner-${dateStr}.log`);
    fs.appendFileSync(logFilePath, formattedLine, 'utf8');

    // Run rotation cleanup once a day
    rotateOldLogs();
  } catch (err) {
    console.error("[LOGGER WRITE ERROR]", err.message);
  }
}
