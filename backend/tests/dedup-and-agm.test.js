/**
 * Permanent Regression & Invariant Test Suite for:
 * 1. Event Alert Deduplication (isEventAlertRecentlySent)
 * 2. AGM Procedural vs Strategic Filtering and Labeling
 */

import { isEventAlertRecentlySent } from '../services/announcement.service.js';
import { formatAnnouncementMessage } from '../services/telegram.service.js';

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

  });
}

runTests().then(() => {
  console.log('\n✅ All Deduplication and AGM tests passed successfully!');
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ Tests failed:', err);
  process.exit(1);
});
