import { describe, expect, it } from 'vitest';
import { classifyFilingCategory, isDocumentedOrderFiling, isPressReleaseDocument, shouldQueueMaterialPressRelease, shouldQueueUnreadableMaterialFiling } from '../services/filing-classifier.service.js';

describe('material press release routing', () => {
  const material = { title: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', priority: 'HIGH', impact: 'POSITIVE', text: 'The company launched a new product and entered a new export market. '.repeat(12) };
  it('queues a substantive business release for source-grounded thesis analysis', () => {
    expect(shouldQueueMaterialPressRelease(material)).toBe(true);
  });
  it('does not queue routine, neutral or unreadable releases on their title alone', () => {
    expect(shouldQueueMaterialPressRelease({ ...material, title: 'Newspaper Publication - Press Release' })).toBe(false);
    expect(shouldQueueMaterialPressRelease({ ...material, priority: 'LOW', impact: 'NEUTRAL' })).toBe(false);
    expect(shouldQueueMaterialPressRelease({ ...material, text: 'Press Release' })).toBe(false);
    expect(shouldQueueMaterialPressRelease({ ...material, title: 'Order win', priority: 'HIGH' })).toBe(false);
  });
  it('queues a documented first product launch even when the AI calls the release LOW/NEUTRAL', () => {
    const text = 'Press Release. The company announced the launch of its first prescription generic product for distribution in a new export market. Its separate regulatory application remains under review.'.repeat(3);
    expect(shouldQueueMaterialPressRelease({ title: 'Press Release', text, priority: 'LOW', impact: 'NEUTRAL' })).toBe(true);
  });
  it('does not turn aspirations or historical milestones into a current launch alert', () => {
    const aspiration = 'The company may explore the launch of a product in a new market, subject to development and approvals. '.repeat(5);
    const history = 'The company launched its first product many years ago and today published a routine media interview. '.repeat(5);
    expect(shouldQueueMaterialPressRelease({ title: 'Press Release', text: aspiration, priority: 'LOW', impact: 'NEUTRAL' })).toBe(false);
    expect(shouldQueueMaterialPressRelease({ title: 'Press Release', text: history, priority: 'LOW', impact: 'NEUTRAL' })).toBe(false);
  });
  it('treats an unreadable release as a document needing retry or review, including a generic exchange title', () => {
    expect(isPressReleaseDocument('Press Release')).toBe(true);
    expect(isPressReleaseDocument('Announcement under Regulation 30 (LODR)-Press Release / Media Release')).toBe(true);
    expect(isPressReleaseDocument('Intimation of Press Release')).toBe(true);
    expect(isPressReleaseDocument('Prior Intimation of Media Interaction')).toBe(false);
    expect(isPressReleaseDocument('Prior Intimation of Press Release')).toBe(false);
    expect(isPressReleaseDocument('Newspaper Publication - Press Release')).toBe(false);
    expect(isPressReleaseDocument('Investor Presentation')).toBe(false);
  });
});

describe('exchange order category', () => {
  it('recognises the standard bagging/receiving orders title even when PDF OCR joins words', () => {
    const title = 'Announcement under Regulation 30 (LODR) - Bagging/receiving of order(s) or contract(s)';
    const text = 'ReceivedOrder of Rs.35 Crores by a wholly owned subsidiary. Exclusive annual contract awarded for supply of industrial packaging.';
    expect(classifyFilingCategory(title, text)).toBe('ORDER_WIN');
  });
  it('recognises slash variant without literal "or" in exchange subject', () => {
    const title = 'Bagging/Receiving of orders/contracts';
    expect(classifyFilingCategory(title, '')).toBe('ORDER_WIN');
    expect(classifyFilingCategory('Announcement under Regulation 30 (LODR) - Bagging/Receiving of orders/contracts', '')).toBe('ORDER_WIN');
    expect(classifyFilingCategory('Company bags contract of Rs 150 Cr', '')).toBe('ORDER_WIN');
    expect(classifyFilingCategory('Secures contract for supply of pipes', '')).toBe('ORDER_WIN');
  });
  it('recognises acquisition titles without trailing "of"', () => {
    expect(classifyFilingCategory('Acquisition', '')).toBe('ACQUISITION');
    expect(classifyFilingCategory('Announcement under Regulation 30 (LODR)-Acquisition', '')).toBe('ACQUISITION');
  });
  it('recognises BSE truncated subjects for investor decks and call transcripts', () => {
    expect(classifyFilingCategory('Announcement under Regulation 30 (LODR)-Investor Presentatio', '')).toBe('QUARTERLY_EARNINGS');
    expect(classifyFilingCategory('Announcement under Regulation 30 (LODR)-Earnings Call Transc', '')).toBe('QUARTERLY_EARNINGS');
  });
  it('surfaces a source-documented contract despite a LOW/NEUTRAL model label', () => {
    const title = 'Announcement under Regulation 30 (LODR) - Bagging/receiving of order(s) or contract(s)';
    const text = 'Our wholly owned subsidiary has been awarded an exclusive annual contract for industrial packaging. The contract value is approximately Rs 35 Crores. '.repeat(3);
    expect(isDocumentedOrderFiling({ title, text, filingCategory: 'ORDER_WIN' })).toBe(true);
    expect(isDocumentedOrderFiling({ title, text: '[NO TEXT EXTRACTED]', filingCategory: 'ORDER_WIN' })).toBe(false);
    expect(isDocumentedOrderFiling({ title: 'Press Release', text: 'The annual report describes orders won in prior years. '.repeat(7), filingCategory: 'ORDER_WIN' })).toBe(false);
  });
});

describe('unreadable material source', () => {
  it('queues a press release or order PDF for retry/review without trusting a title-only AI summary', () => {
    const base = { text: 'TITLE: Press Release\nCONTENT: [NO TEXT EXTRACTED: source unreadable]', attachmentUrl: 'https://example.test/filing.pdf' };
    expect(shouldQueueUnreadableMaterialFiling({ ...base, title: 'Press Release', filingCategory: 'GENERAL' })).toBe(true);
    expect(shouldQueueUnreadableMaterialFiling({ ...base, title: 'Bagging/receiving of order(s) or contract(s)', filingCategory: 'ORDER_WIN' })).toBe(true);
    expect(shouldQueueUnreadableMaterialFiling({ ...base, title: 'Newspaper Publication', filingCategory: 'ROUTINE_COMPLIANCE' })).toBe(false);
    expect(shouldQueueUnreadableMaterialFiling({ ...base, title: 'Press Release', filingCategory: 'GENERAL', attachmentUrl: null })).toBe(false);
  });
});
