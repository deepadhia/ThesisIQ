import {describe, expect, it} from 'vitest';
import {transcriptPdfLinkFromCover, presentationPdfLinkFromCover, isSubstantiveConcallTranscript} from '../services/announcement.service.js';
import {canCompareConcallSources} from '../services/audio-transcript-analyzer.service.js';

const cover = `Sub: Transcript of the Conference Call held on November 06, 2026\nPlease find the link of the transcript on the Company's website:\nhttps://www.example-company.com/reports/q2-transcript.pdf\nThanking you, Company Secretary`;
const transcript = `Moderator: Welcome to the results call.\n${'Analyst: What changed in guidance?\nManagement: The published target remains in force.\n'.repeat(100)}`;

describe('concall source integrity', () => {
  it('resolves a public HTTPS PDF linked from a cover letter, but not ordinary prose or private URLs', () => {
    expect(transcriptPdfLinkFromCover(cover)).toBe('https://www.example-company.com/reports/q2-transcript.pdf');
    expect(transcriptPdfLinkFromCover(transcript)).toBeNull();
    expect(transcriptPdfLinkFromCover(cover.replace('www.example-company.com', 'localhost'))).toBeNull();
  });
  it('a covering letter is not substantive call content', () => {
    expect(isSubstantiveConcallTranscript(cover)).toBe(false);
    expect(isSubstantiveConcallTranscript(transcript)).toBe(true);
  });
  it('follows a linked presentation PDF only from a short presentation cover', () => {
    const deckCover = 'Investor Presentation for quarterly results is available on our website at the following link: https://www.example-company.com/q2-presentation.pdf';
    expect(presentationPdfLinkFromCover(deckCover)).toBe('https://www.example-company.com/q2-presentation.pdf');
    expect(presentationPdfLinkFromCover(deckCover.replace('q2-presentation.pdf', 'annual-report.pdf'))).toBeNull();
    expect(presentationPdfLinkFromCover(deckCover.replace('www.example-company.com', 'localhost'))).toBeNull();
  });
  it('forensic comparison requires different records and both full transcript texts', () => {
    expect(canCompareConcallSources({audioId:'a',writtenId:'a',audioText:transcript,writtenText:transcript})).toBe(false);
    expect(canCompareConcallSources({audioId:'a',writtenId:'b',audioText:null,writtenText:transcript})).toBe(false);
    expect(canCompareConcallSources({audioId:'a',writtenId:'b',audioText:transcript,writtenText:cover})).toBe(false);
    expect(canCompareConcallSources({audioId:'a',writtenId:'b',audioText:transcript,writtenText:transcript})).toBe(true);
  });
});
