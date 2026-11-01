import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "./config/dataDir.js";
import { isDriveConfigured, getDriveClient } from "./services/drive.service.js";
import { pool } from "./db/pool.js";
import { healthRouter } from "./routes/health.routes.js";
import { stocksRouter } from "./routes/stocks.routes.js";
import { transcriptsRouter } from "./routes/transcripts.routes.js";
import { proxyRouter } from "./routes/proxy.routes.js";
import { priceRouter } from "./routes/price.routes.js";
import { financialsRouter } from "./routes/financials.routes.js";
import {
  loginHandler,
  logoutHandler,
  meHandler,
  driveStartHandler,
  driveCallbackHandler,
} from "./routes/auth.routes.js";
import { geminiRouter } from "./routes/gemini.routes.js";
import { marketRouter } from "./routes/market.routes.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { xbrlRouter } from "./routes/xbrl.routes.js";

export const app = express();

// Parse FRONTEND_URL to support comma-separated list and remove trailing slashes
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:8080")
  .split(",")
  .map((url) => url.trim().replace(/\/$/, ""));

const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    // flexibly allow any vercel preview deployment or explicitly allowed origins
    if (origin.endsWith(".vercel.app") || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Log CORS failures to help debug
    console.warn(
      `CORS blocked for origin: ${origin}. Expected one of: ${allowedOrigins.join(", ")} or any .vercel.app domain`,
    );
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());

// --- Public ---
app.use(healthRouter);

app.post("/api/auth/login", loginHandler);
app.post("/api/auth/logout", logoutHandler);
app.get("/api/auth/me", meHandler);

// Google redirects here (must stay public)
app.get("/api/auth/drive/callback", driveCallbackHandler);

// --- Protected (JWT cookie or Bearer) ---
app.use(requireAuth);

app.get("/api/auth/drive/start", driveStartHandler);

// Static files for downloaded PDFs, with a dynamic fallback to Google Drive if missing locally
app.get("/files/:symbol/:quarter/:filename", async (req, res, next) => {
  const { symbol, quarter, filename } = req.params;
  const baseDir = path.resolve(getDataDir());
  const filePath = path.resolve(baseDir, symbol, quarter, filename);

  if (!filePath.startsWith(baseDir + path.sep)) {
    return res.status(400).json({ ok: false, error: "Invalid file path" });
  }

  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }

  // If missing locally, try to stream from Google Drive
  try {
    const normalizedSymbol = String(symbol).toUpperCase();
    const linksRes = await pool.query(
      "SELECT drive_file_id FROM filing_drive_links WHERE symbol = $1 AND quarter = $2 AND filename = $3",
      [normalizedSymbol, quarter, filename],
    );
    const driveFileId = linksRes.rows[0]?.drive_file_id;

    if (driveFileId && isDriveConfigured()) {
      const drive = await getDriveClient();
      console.log(
        `[files API] Streaming ${symbol}/${quarter}/${filename} from Google Drive ID: ${driveFileId}`,
      );
      const driveRes = await drive.files.get(
        { fileId: driveFileId, alt: "media" },
        { responseType: "stream" },
      );
      res.setHeader(
        "Content-Type",
        filename.toLowerCase().endsWith(".xml")
          ? "text/xml"
          : "application/pdf",
      );
      const safeFilename = path.basename(filename).replace(/["\\\r\n]/g, "_");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${safeFilename}"`,
      );
      driveRes.data.pipe(res);
      return;
    }
  } catch (err) {
    console.error(
      `[files API] Error fetching ${symbol}/${quarter}/${filename} from Google Drive:`,
      err.message,
    );
  }

  // Fall back to express.static (which will send 404)
  next();
});

app.use("/files", express.static(getDataDir()));

app.use(proxyRouter);
app.use(marketRouter);
app.use(priceRouter);
app.use(financialsRouter);
app.use(stocksRouter);
app.use(transcriptsRouter);
app.use(geminiRouter);
app.use(xbrlRouter);
