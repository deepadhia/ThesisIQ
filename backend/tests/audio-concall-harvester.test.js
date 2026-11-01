import { describe, it, expect, vi } from "vitest";
import {
  extractAudioUrlFromFiling,
  resolveAudioMediaUrl,
  transcribeAudioWithGroqWhisper
} from "../services/audio-transcript-analyzer.service.js";

// Production runs on plain Node (AbortSignal.timeout exists); the jsdom test environment's AbortSignal lacks it.
if (typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("TimeoutError")), ms).unref?.();
    return controller.signal;
  };
}

describe("Audio Concall Harvester", () => {
  describe("extractAudioUrlFromFiling", () => {
    it("extracts direct mp3 link from filing text", () => {
      const text = "Audio recording is available at https://storage.company.com/audio/q2_call.mp3 for investors.";
      expect(extractAudioUrlFromFiling(text)).toBe("https://storage.company.com/audio/q2_call.mp3");
    });

    it("extracts webcast links from ChorusCall, ResearchBytes and YouTube", () => {
      expect(extractAudioUrlFromFiling("Webcast: https://services.choruscall.in/DiamondPassRegistration/webcast?confid=123")).toBe("https://services.choruscall.in/DiamondPassRegistration/webcast?confid=123");
      expect(extractAudioUrlFromFiling("Listen on YouTube: https://youtu.be/yWwtP6AVDN0")).toBe("https://youtu.be/yWwtP6AVDN0");
      expect(extractAudioUrlFromFiling("Researchbytes link: https://www.researchbytes.com/webcast.aspx?id=999")).toBe("https://www.researchbytes.com/webcast.aspx?id=999");
    });

    it("extracts company IR landing pages from Lumax-style Regulation 30 intimation", () => {
      const lumaxText = `
        Pursuant to Regulation 30 of SEBI (LODR) Regulations, 2015, the Audio Recording Link
        of Earnings Conference Call of all Investors held today i.e. October 27, 2026 is available
        on the website of the Company and can be accessed at below mentioned link:
        https://www.lumaxworld.in/lumaxautotech/transcript.html
        You are requested to kindly take the same in your records.
      `;
      expect(extractAudioUrlFromFiling(lumaxText)).toBe("https://www.lumaxworld.in/lumaxautotech/transcript.html");
    });

    it("reconnects URLs wrapped across line breaks in PDF text", () => {
      const wrapped = "Recording link: https://www.company.com/investor-\nrelations/audio/q2.mp3";
      expect(extractAudioUrlFromFiling(wrapped)).toBe("https://www.company.com/investor-relations/audio/q2.mp3");
    });

    it("ignores exchange URLs (NSE/BSE archives) and picks the company's recording URL", () => {
      const text = `
        Audio recording notice for Q2 FY27.
        Exchange announcement published on https://www.bseindia.com/corporates/ann.html.
        Recording URL: https://ir.company.com/earnings-call-audio
      `;
      expect(extractAudioUrlFromFiling(text)).toBe("https://ir.company.com/earnings-call-audio");
    });
  });

  describe("resolveAudioMediaUrl", () => {
    it("returns DIRECT_AUDIO for direct .mp3 / .wav / .m4a URLs", async () => {
      const res = await resolveAudioMediaUrl("https://media.company.com/call.mp3");
      expect(res).toEqual({ type: "DIRECT_AUDIO", url: "https://media.company.com/call.mp3" });
    });

    it("returns YOUTUBE for direct YouTube URLs", async () => {
      const res = await resolveAudioMediaUrl("https://youtu.be/yWwtP6AVDN0");
      expect(res).toEqual({ type: "YOUTUBE", url: "https://youtu.be/yWwtP6AVDN0" });
    });

    it("inspects HTML landing page and resolves embedded YouTube link", async () => {
      const fakeHtml = `
        <html>
          <body>
            <h1>Earnings Call Recordings</h1>
            <a href="https://youtu.be/yWwtP6AVDN0">Audio Recording of Q2 FY27 Earnings Call</a>
          </body>
        </html>
      `;
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => fakeHtml
      });

      const res = await resolveAudioMediaUrl("https://www.company.com/transcript.html", { fetchFn: fakeFetch });
      expect(res).toEqual({
        type: "YOUTUBE",
        url: "https://youtu.be/yWwtP6AVDN0",
        originalUrl: "https://www.company.com/transcript.html"
      });
    });

    it("inspects HTML landing page and resolves embedded direct MP3 link", async () => {
      const fakeHtml = `
        <html>
          <body>
            <audio src="/downloads/q2_call_recording.mp3"></audio>
          </body>
        </html>
      `;
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => fakeHtml
      });

      const res = await resolveAudioMediaUrl("https://www.company.com/media/audio.html", { fetchFn: fakeFetch });
      expect(res.type).toBe("DIRECT_AUDIO");
      expect(res.url).toBe("https://www.company.com/downloads/q2_call_recording.mp3");
    });
  });

  describe("transcribeAudioWithGroqWhisper", () => {
    it("throws clear error when GROK_API_KEY is not configured", async () => {
      await expect(transcribeAudioWithGroqWhisper("non_existent.mp3", { apiKey: "" }))
        .rejects.toThrow("GROK_API_KEY is not configured");
    });
  });
});
