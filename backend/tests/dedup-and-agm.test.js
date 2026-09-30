/**
 * Permanent Regression & Invariant Test Suite for:
 * 1. Event Alert Deduplication (isEventAlertRecentlySent)
 * 2. AGM Procedural vs Strategic Filtering and Labeling
 */

import { isEventAlertRecentlySent, extractResultDateFromText } from '../services/announcement.service.js';
import { formatAnnouncementMessage, sendAnnouncementAlert } from '../services/telegram.service.js';
import { classifyFilingCategory } from '../services/filing-classifier.service.js';
import { pool } from '../db/pool.js';

// Hermetic mock of pool.query to simulate recent historical DB alerts
const origPoolQuery = pool.query;
pool.query = async (text, params) => {
  const queryStr = String(text || '');
  const ticker = params && params[0];

  if (ticker === 'TIMETECHNO') {
    // 1. Filename match: only match if checking for Outcome29092026
    if (queryStr.includes('attachment_url ILIKE')) {
      const matchPattern = params && params[1];
      if (matchPattern && String(matchPattern).includes('Outcome29092026')) {
        return {
          rows: [{
            id: 'test-timetechno-prev',
            ticker: 'TIMETECHNO',
            title: 'Scheme of Arrangement',
            summary: 'Time Technoplast board approved merger of 74.86% subsidiary TPL Plastech into parent company.',
            attachment_url: 'https://nsearchives.nseindia.com/corporate/TIMETECHNO_29092026204150_Outcome29092026_signed.pdf',
            filing_category: 'RESTRUCTURING',
            sent_to_telegram: true,
            processed_at: new Date()
          }]
        };
      }
      return { rows: [] };
    }

    // 2. Category match: only match if checking for RESTRUCTURING
    if (queryStr.includes('filing_category =')) {
      const catParam = params && (params[1] || params[2]);
      if (catParam === 'RESTRUCTURING' || queryStr.includes("'RESTRUCTURING'")) {
        return {
          rows: [{
            id: 'test-timetechno-prev',
            ticker: 'TIMETECHNO',
            title: 'Scheme of Arrangement',
            summary: 'Time Technoplast board approved merger of 74.86% subsidiary TPL Plastech into parent company.',
            attachment_url: 'https://nsearchives.nseindia.com/corporate/TIMETECHNO_29092026204150_Outcome29092026_signed.pdf',
            filing_category: 'RESTRUCTURING',
            sent_to_telegram: true,
            processed_at: new Date()
          }]
        };
      }
      return { rows: [] };
    }

    // 3. Entity overlap match: check if summary matches TPL Plastech
    if (queryStr.includes('summary ILIKE') || queryStr.includes('title ILIKE')) {
      return {
        rows: [{
          id: 'test-timetechno-prev',
          ticker: 'TIMETECHNO',
          title: 'Scheme of Arrangement',
          summary: 'Time Technoplast board approved merger of 74.86% subsidiary TPL Plastech into parent company.',
          attachment_url: 'https://nsearchives.nseindia.com/corporate/TIMETECHNO_29092026204150_Outcome29092026_signed.pdf',
          filing_category: 'RESTRUCTURING',
          sent_to_telegram: true,
          processed_at: new Date()
        }]
      };
    }
  }

  return origPoolQuery.apply(pool, [text, params]);
};

// Polyfill describe / test / expect for standalone node execution
const testFn = typeof test !== 'undefined' ? test : (name, fn) => {
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res.then(() => console.log(`  ✓ PASS: ${name}`))
                .catch((err) => {
                  console.error(`  ❌ FAIL: ${name} (${err.message})`);
                  throw err;
                });
    }
    console.log(`  ✓ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name} (${err.message})`);
    throw err;
  }
};

const describeFn = typeof describe !== 'undefined' ? describe : async (name, fn) => {
  console.log(`\n--- ${name} ---`);
  await fn();
};

const expectFn = (actual) => ({
  toBe: (expected) => {
    if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
  },
  toContain: (expected) => {
    if (!actual || !actual.includes(expected)) throw new Error(`Expected "${actual}" to contain "${expected}"`);
  },
  not: {
    toContain: (expected) => {
      if (actual && actual.includes(expected)) throw new Error(`Expected "${actual}" NOT to contain "${expected}"`);
    }
  }
});

async function runTests() {
  await describeFn('Event Alert Deduplication Invariants (TIMETECHNO Case Study)', async () => {

    await testFn('Identical base document name with different NSE upload timestamps must be caught as duplicate', async () => {
      // TIMETECHNO filing 1 was TIMETECHNO_29092026204150_Outcome29092026_signed.pdf (in DB)
      // TIMETECHNO filing 2 was TIMETECHNO_29092026204808_Outcome29092026_signed.pdf
      const isDup = await isEventAlertRecentlySent({
        ticker: 'TIMETECHNO',
        title: 'Scheme of Arrangement',
        summary: 'Time Technoplast board approved merger of 74.86% subsidiary TPL Plastech...',
        attachment_url: 'https://nsearchives.nseindia.com/corporate/TIMETECHNO_29092026204808_Outcome29092026_signed.pdf',
        filing_category: 'RESTRUCTURING'
      });
      expectFn(isDup).toBe(true);
    });

    await testFn('Major corporate action category (RESTRUCTURING) within rolling window must be caught as duplicate', async () => {
      const isDup = await isEventAlertRecentlySent({
        ticker: 'TIMETECHNO',
        title: 'Outcome of Board Meeting',
        summary: 'Merger of subsidiary TPL Plastech into parent',
        attachment_url: 'https://nsearchives.nseindia.com/corporate/different_filename.pdf',
        filing_category: 'RESTRUCTURING'
      });
      expectFn(isDup).toBe(true);
    });

    await testFn('Summary entity overlap ("TPL Plastech") under same category must be caught as duplicate', async () => {
      const isDup = await isEventAlertRecentlySent({
        ticker: 'TIMETECHNO',
        title: 'Corporate Update on Merger',
        summary: 'Update regarding amalgamation of TPL Plastech with Time Technoplast',
        attachment_url: 'https://nsearchives.nseindia.com/corporate/random_name.pdf',
        filing_category: 'RESTRUCTURING'
      });
      expectFn(isDup).toBe(true);
    });

    await testFn('Distinct corporate action category (e.g. ORDER_WIN) for same ticker must NOT be blocked', async () => {
      const isDup = await isEventAlertRecentlySent({
        ticker: 'TIMETECHNO',
        title: 'Commercial Order Win for Type-IV Composite Cylinders',
        summary: 'Received major export contract worth ₹185 Cr for Type-IV composite cylinders',
        attachment_url: 'https://nsearchives.nseindia.com/corporate/TIMETECHNO_Order_Signed.pdf',
        filing_category: 'ORDER_WIN'
      });
      expectFn(isDup).toBe(false);
    });

  });

  await describeFn('AGM Alert Gate & Labeling Invariants', async () => {

    await testFn('Procedural AGM voting cover letter must NOT be labeled as "Strategic Address"', () => {
      // Simulate formatting for procedural AGM voting proceedings
      const message = formatAnnouncementMessage({
        ticker: 'QPOWER',
        companyName: 'Quality Power Electrical Equipments',
        title: 'Shareholders meeting',
        priority: 'LOW',
        impact: 'NEUTRAL',
        summary: 'QPOWER completed its 25th AGM transacting routine ordinary and special business.',
        is_agm: true,
        agm_status: 'completed',
        has_substantive_business_insights: false
      });

      expectFn(message).toContain('AGM Voting Proceedings (Procedural)');
      expectFn(message).not.toContain('Strategic Address');
    });

    await testFn('Substantive Chairman Speech must be labeled "AGM Chairman\'s Strategic Address"', () => {
      const message = formatAnnouncementMessage({
        ticker: 'QPOWER',
        companyName: 'Quality Power Electrical Equipments',
        title: 'Chairman Address at 25th AGM',
        priority: 'HIGH',
        impact: 'POSITIVE',
        summary: 'Chairman outlined 3x capacity expansion in HVDC transformers and ₹1,200 Cr order pipeline.',
        forward_catalysts: ['Commissioning of 765kV testing facility by Q3 FY27'],
        is_agm: true,
        agm_status: 'completed',
        has_substantive_business_insights: true
      });

      expectFn(message).toContain("AGM Chairman's Strategic Address");
      expectFn(message).toContain('Strategic Insights & Forward Guidance:');
      expectFn(message).toContain('Commissioning of 765kV testing facility by Q3 FY27');
    });

    await testFn('AGM Investor Presentation must be labeled "AGM Investor Presentation & Strategy"', () => {
      const message = formatAnnouncementMessage({
        ticker: 'SHAKTIPUMP',
        companyName: 'Shakti Pumps (India) Limited',
        title: 'Investor Presentation - 29th Annual General Meeting',
        priority: 'MEDIUM',
        impact: 'POSITIVE',
        summary: 'Management presented solar pump market expansion, PM KUSUM component B & C order visibility.',
        is_agm: true,
        agm_status: 'completed',
        has_substantive_business_insights: true
      });

      expectFn(message).toContain('AGM Investor Presentation & Strategy');
    });

    await testFn('Procedural AGM voting proceeding must be suppressed by sendAnnouncementAlert', async () => {
      const res = await sendAnnouncementAlert({
        ticker: 'POLICYBZR',
        companyName: 'PB Fintech Ltd',
        title: 'Shareholders meeting',
        priority: 'HIGH',
        impact: 'NEUTRAL',
        summary: 'Adoption of audited financial statements and director reappointments passed with 99.8% majority.',
        is_agm: true,
        agm_status: 'completed',
        has_substantive_business_insights: false
      });

      expectFn(res).toBe(false);
    });

  });

  await describeFn('Filing Classification & High-Impact Keyword Invariants (SJS Case Study)', async () => {

    await testFn('Generic "General Updates" title with Rights Issue text must classify as CAPITAL_RAISE', () => {
      const category = classifyFilingCategory(
        'General Updates',
        'Intimation of investment through Rights Issue in SJS Display Electronics Private Limited (SDEPL), a wholly owned subsidiary'
      );
      expectFn(category).toBe('CAPITAL_RAISE');
    });

    await testFn('Procedural voting results title must classify as ROUTINE_COMPLIANCE', () => {
      const category = classifyFilingCategory(
        'Voting Results of 18th Annual General Meeting',
        'Details of voting results as per Regulation 44 of SEBI LODR Regulations'
      );
      expectFn(category).toBe('ROUTINE_COMPLIANCE');
    });

  });

  await describeFn('Board Meeting Result Date Extraction Invariants', async () => {

    await testFn('Must extract upcoming results date from standard board meeting intimation (ANANTRAJ Case Study)', () => {
      const text = `a meeting of the Board of Directors of Anant Raj Limited ('the Company') is scheduled to be held on Wednesday, October 28, 2026, inter-alia, to consider, approve and take on record the Unaudited Financial Results (Standalone and Consolidated) for the quarter and half year ending September 30, 2026.`;
      const date = extractResultDateFromText(text);
      expectFn(date).toBe('2026-10-28');
    });

    await testFn('Must extract date from day-first format (28th October, 2026)', () => {
      const text = `The Board Meeting is scheduled to be held on 28th October, 2026 to consider unaudited quarterly financial results.`;
      const date = extractResultDateFromText(text);
      expectFn(date).toBe('2026-10-28');
    });

    await testFn('Must return null if meeting is not considering financial results', () => {
      const text = `A meeting of the Board of Directors is scheduled to be held on October 28, 2026 to consider issue of employee stock options.`;
      const date = extractResultDateFromText(text);
      expectFn(date).toBe(null);
    });

  });
}

if (!process.env.VITEST) {
  runTests().then(() => {
    console.log('\n✅ All Deduplication and AGM tests passed successfully!');
    process.exit(0);
  }).catch((err) => {
    console.error('\n❌ Tests failed:', err);
    process.exit(1);
  });
} else {
  await runTests();
}
