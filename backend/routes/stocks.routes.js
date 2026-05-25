import express from "express";
import {
  resetInsightsHandler,
  resetAllJsonOutputsHandler,
  refreshScreenerDataHandler,
  scanAnnouncementsHandler,
  createStockHandler,
  getAnnouncementsHandler,
  refreshAnnouncementsHandler,
} from "../controllers/stocks.controller.js";

export const stocksRouter = express.Router();

stocksRouter.get("/api/stocks/:id/announcements", getAnnouncementsHandler);
stocksRouter.post("/api/stocks/:id/refresh-announcements", refreshAnnouncementsHandler);
stocksRouter.post("/api/stocks/:id/reset-insights", resetInsightsHandler);
stocksRouter.post("/api/stocks/reset-all-json", resetAllJsonOutputsHandler);
stocksRouter.post("/api/stocks/refresh-screener-data", refreshScreenerDataHandler);
stocksRouter.post("/api/stocks/scan-announcements", scanAnnouncementsHandler);
stocksRouter.post("/api/stocks", createStockHandler);

