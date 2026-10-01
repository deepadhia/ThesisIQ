/**
 * Invariant Test Suite for System-Wide Alert Formatting
 * Ensures all alert templates adhere to the institutional Bloomberg/Goldman design standard:
 * 1. Standard header: 🏢 *TICKER* | Company Name
 * 2. Event badge: 📢 *Event:* ...
 * 3. Uniform 30-character divider: ──────────────────────────────
 * 4. Zero invalid Markdown (no double asterisks '**')
 */

import { formatAnnouncementMessage } from '../services/telegram.service.js';
import { formatDislocationTelegramMessage } from '../services/valuation-dislocation-watchdog.service.js';

// Polyfill describe / it / expect for seamless compatibility with both Vitest and standalone Node
const describeFn = typeof describe !== 'undefined' ? describe : (name, fn) => {
  console.log(`\n--- ${name} ---`);
  return fn();
};

const testFn = typeof it !== 'undefined' ? it : (typeof test !== 'undefined' ? test : (name, fn) => {
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
});

const expectFn = (actual) => {
  if (typeof expect !== 'undefined') {
    const vitestExpect = expect(actual);
    return {
      toContain: (expected) => vitestExpect.toContain(expected),
      notToContain: (unexpected) => vitestExpect.not.toContain(unexpected),
      toBe: (expected) => vitestExpect.toBe(expected)
    };
  }
  return {
    toContain: (expected) => {
      if (!String(actual).includes(expected)) {
        throw new Error(`Expected to contain "${expected}" but was: \n${actual}`);
      }
    },
    notToContain: (unexpected) => {
      if (String(actual).includes(unexpected)) {
        throw new Error(`Expected NOT to contain "${unexpected}" but was found in: \n${actual}`);
      }
    },
    toBe: (expected) => {
      if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
    }
  };
};
  await describeFn('Corporate Filing Alert Formatting Invariants', async () => {
    await testFn('Order Win alert must have uniform header, 30-char divider, and zero double asterisks', () => {
      const msg = formatAnnouncementMessage({
        ticker: 'HBLENGINE',
        companyName: 'HBL Power Systems Ltd',
        title: 'Award of major contract for Kavach TCAS',
        priority: 'HIGH',
        impact: 'POSITIVE',
        filing_category: 'ORDER_WIN',
        summary: 'Received purchase order worth ₹574 Cr for supply and installation of Kavach locomotive units.',
        eventAnalysis: {
          extracted_data: {
            order_value_cr: '574',
            client_name: 'Indian Railways - Eastern Zone',
            execution_period_months: '18',
            scope_and_voltage: 'Supply and installation of Kavach train collision avoidance equipment'
          }
        },
        docUrl: 'https://bseindia.com/filing.pdf'
      });

      expectFn(msg).toContain('🏢 *HBLENGINE* | HBL Power Systems Ltd');
      expectFn(msg).toContain('📢 *Event:* Order Win & Contract Award • 🔴 High Priority');
      expectFn(msg).toContain('──────────────────────────────');
      expectFn(msg).toContain('📊 *Order Highlights:*');
      expectFn(msg).toContain('• Total Value: ₹574 Cr');
      expectFn(msg).toContain('• Client: Indian Railways - Eastern Zone');
      expectFn(msg).notToContain('**'); // Zero double asterisks
    });

    await testFn('M&A Acquisition alert must format consideration and rationale cleanly', () => {
      const msg = formatAnnouncementMessage({
        ticker: 'LUMAXTECH',
        companyName: 'Lumax Auto Technologies Limited',
        title: 'Acquisition of majority stake in IAC India',
        priority: 'HIGH',
        impact: 'POSITIVE',
        filing_category: 'ACQUISITION',
        summary: 'Board approved acquisition of 75% equity stake in IAC International Automotive India for ₹587 Cr.',
        eventAnalysis: {
          extracted_data: {
            target_company: 'IAC International Automotive India Pvt Ltd',
            deal_value_cr: '587',
            cash_consideration_cr: '587',
            strategic_rationale: 'Expands Tier-1 interior systems footprint with marquee 4W OEM clients'
          }
        }
      });

      expectFn(msg).toContain('🏢 *LUMAXTECH* | Lumax Auto Technologies Ltd');
      expectFn(msg).toContain('📢 *Event:* 🤝 M&A / Strategic Acquisition • 🔴 High Priority');
      expectFn(msg).toContain('📊 *M&A Consideration & Synergies:*');
      expectFn(msg).toContain('• Target Entity: IAC International Automotive India Pvt Ltd');
      expectFn(msg).toContain('• Total Consideration: ₹587 Cr');
      expectFn(msg).notToContain('**');
    });

    await testFn('Commissioning Milestone alert must trigger Key Milestone banner', () => {
      const msg = formatAnnouncementMessage({
        ticker: 'TIMETECHNO',
        companyName: 'Time Technoplast Limited share price',
        title: 'Commercial production commenced for Type-IV Composite Cylinders',
        priority: 'HIGH',
        impact: 'POSITIVE',
        filing_category: 'CAPEX_COMMISSIONING',
        summary: 'Commenced commercial dispatch of Type-IV composite cylinders from Silvassa unit.',
        eventAnalysis: {
          extracted_data: {
            capacity_added_or_expanded: '1,000,000 cylinders p.a.',
            facility_location: 'Silvassa'
          }
        }
      });

      expectFn(msg).toContain('🏢 *TIMETECHNO* | Time Technoplast Ltd');
      expectFn(msg).toContain('📢 *Event:* 🏆 Key Thesis Milestone: Capacity Expansion & Commissioning • 🟢 *High Catalyst*');
      expectFn(msg).toContain('⭐ *MILESTONE FULFILLMENT:* 🟢 *COMMISSIONED & OPERATIONAL*');
      expectFn(msg).notToContain('share price');
      expectFn(msg).notToContain('**');
    });
  });

  await describeFn('Valuation Dislocation Watchdog Formatting Invariants', async () => {
    await testFn('Watchdog alert must use standardized header, dividers, and proper markdown formatting', () => {
      const msg = formatDislocationTelegramMessage({
        ticker: 'HBLENGINE',
        companyName: 'HBL Power Systems Ltd share price',
        sector: 'Rail & Defence Engineering',
        price: 766.15,
        pe: 28.5,
        mispricingScore: 88,
        metrics: {
          expectationGap: 14.2,
          underwrittenNopatCagr: 32.0,
          impliedGrowth: 17.8,
          expectationsRegime: 'SUBSTANTIAL_UNDEREXPECTATION',
          stressTestedExpectationGap: 11.4,
          thesisRobustness: 'VERY_HIGH',
          roce: 31.2,
          roceRegimeClassification: 'ELITE_CAPITAL_ALLOCATOR',
          debtToEquity: 0.05,
          cfoPatRatio: 0.94,
          receivableDays: 62
        },
        hedgeFundScorecard: {
          fairValuePrice: 1042,
          buyBelowPrice: 780,
          bearFloorPrice: 580,
          asymmetryRatio: 3.4,
          projected3YrIrr: 28.4,
          thesisBreakerMetric: 'Kavach installation run-rate < 150 locos/quarter'
        }
      }, {
        triggerReason: '200_EMA_PULLBACK_HIGH_CONVICTION',
        triggerMechanics: 'Tested 200 EMA support band with 28% discount to DCF Fair Value',
        whatChanged: 'Short-term market volatility created asymmetrical 3.4:1 entry opportunity',
        actionableJustification: 'Tier-1 allocation candidate with debt-free balance sheet and expanding order book'
      });

      expectFn(msg).toContain('🏢 *HBLENGINE* | HBL Power Systems Ltd');
      expectFn(msg).toContain('🎯 *Event:* Asymmetric Valuation Dislocation • `TOP_CONVICTION`');
      expectFn(msg).toContain('──────────────────────────────');
      expectFn(msg).toContain('• Intrinsic Fair Value: *₹1042*');
      expectFn(msg).toContain('• Asymmetry Risk/Reward: *3.4:1*');
      expectFn(msg).toContain('• 🚨 *Thesis-Breaker Red Line*: `Kavach installation run-rate < 150 locos/quarter`');
      expectFn(msg).notToContain('share price');
      expectFn(msg).notToContain('**');
    });
  });

  if (!process.env.VITEST) {
    console.log('\n✅ All Alert Formatting tests passed successfully!');
  }
