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

    it("reads a media link printed WITHOUT https:// (SJS 2026-11-05: 'available on the website of the Company at sjsindia.com/Docs/FY2627/Q2/FY27Q2FEACV1.mp3')", () => {
      const sjs = `the audio recording of the same is available on the website of the Company at
sjsindia.com/Docs/FY2627/Q2/FY27Q2FEACV1.mp3.
Request you to kindly take the above on record.`;
      expect(extractAudioUrlFromFiling(sjs)).toBe("https://sjsindia.com/Docs/FY2627/Q2/FY27Q2FEACV1.mp3");
      expect(extractAudioUrlFromFiling("recording: www.example.co.in/ir/q2/call.m4a, thank you")).toBe("https://www.example.co.in/ir/q2/call.m4a");
    });

    it("a bare website or an e-mail address in the letter is not a media link", () => {
      expect(extractAudioUrlFromFiling("Email: info@sjsindia.com, compliance@sjsindia.com  www.sjsindia.com Creating Possibilities")).toBeNull();
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

    it("a meeting-joining link is never a recording, and a wrapped link is not glued to the next sentence (POLICYBZR 2026-10-27: 'register/WN_c2cb8g6AQeejnEt0RyZAwQ' + 'Once registered...' became a 404 'audio' link)", () => {
      const intimation = `Participants are requested to register using the link below:
https://zoom.us/webinar/register/WN_c2cb8g6AQeejnEt0RyZAwQ
Once registered, a confirmation email will be sent with important details for this call. Further, the transcript and an audio recording will be made available on the website of the company at www.pbfintech.in.
You are requested to kindly take the same in your records.`;
      expect(extractAudioUrlFromFiling(intimation)).toBeNull();
      expect(extractAudioUrlFromFiling("Join: https://us02web.zoom.us/j/84012345678?pwd=abc and https://teams.microsoft.com/l/meetup-join/19%3ameeting_x")).toBeNull();
      expect(extractAudioUrlFromFiling("Join: https://meet.google.com/abc-defg-hij. Audio recording will follow.")).toBeNull();
      // a recorded Zoom share IS a recording
      expect(extractAudioUrlFromFiling("Audio recording: https://zoom.us/rec/share/AbCdEf123")).toBe("https://zoom.us/rec/share/AbCdEf123");
    });

    it("still reconnects a link wrapped mid-name when the next line is only the rest of the link (QPOWER 2026-11-02)", () => {
      const qpower = `at the following link once the technical issue is resolved:
https://qualitypower.com/wp-content/uploads/2026/09/Quality-Power-Q2FY27-Concall-
Audio.mp3
Thanking You,
Yours faithfully,`;
      expect(extractAudioUrlFromFiling(qpower)).toBe("https://qualitypower.com/wp-content/uploads/2026/09/Quality-Power-Q2FY27-Concall-Audio.mp3");
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

describe("which key runs Whisper (the worker looked only at GROK_API_KEY, so a server configured with GROQ_API_KEY never transcribed a call)", async () => {
  const { getWhisperApiKey } = await import("../services/audio-transcript-analyzer.service.js");
  it("GROQ_API_KEY is used", () => expect(getWhisperApiKey({ GROQ_API_KEY: "gsk_abc" })).toBe("gsk_abc"));
  it("GROK_API_KEY counts only when it is a Groq key (gsk_), never an xAI key", () => {
    expect(getWhisperApiKey({ GROK_API_KEY: "gsk_abc" })).toBe("gsk_abc");
    expect(getWhisperApiKey({ GROK_API_KEY: "xai-abc" })).toBe("");
  });
  it("neither set: no key", () => expect(getWhisperApiKey({})).toBe(""));
});
