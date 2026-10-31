import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import fs from 'fs';
import path from 'path';
import { loadPortfolioCapacityValuationBoard } from '../services/capacity-normalized-valuation.service.js';
import { pool } from '../db/pool.js';

async function runCapacityValuationBoard() {
  console.log('--- 📊 Generating Portfolio Capacity-Normalized Valuation Board (20 Stocks) ---');
  try {
    const rows = await loadPortfolioCapacityValuationBoard();
    if (!rows || rows.length === 0) {
      console.error('❌ No stocks loaded. Ensure market_data_snapshots and portfolio_capacity_engines are seeded.');
      process.exit(1);
    }

    console.log(`✅ Loaded ${rows.length} portfolio companies with verified capacity engines.\n`);

    console.table(rows.map(r => ({
      Ticker: r.ticker,
      CMP: `₹${r.currentPrice}`,
      'Trail P/E': `${r.trailingPe}x`,
      'Cap Fwd P/E': `${r.capacityForwardPe}x`,
      'Exit P/E': `${r.exitPe}x`,
      'Buffer %': `${r.compressionBufferPct > 0 ? '+' : ''}${r.compressionBufferPct}%`,
      Verdict: r.compressionVerdict,
      Tranche: r.trancheAction
    })));

    // Generate Comprehensive Markdown Report
    let md = `# Portfolio Capacity-Normalized Valuation & P/E Compression Board\n\n`;
    md += `**Generated**: ${new Date().toISOString()}  \n`;
    md += `**Methodology**: Dynamic Asset-Turnover Capacity Normalization & ROCE-Tethered Terminal Compression Stress Testing\n\n`;

    md += `| Ticker | CMP | Trailing P/E | ROCE | Primary Growth Engine | Full-Capacity PAT | Capacity Fwd P/E | Exit P/E | Compression Buffer % | Verdict | Tranche Allocation |\n`;
    md += `| :--- | :---: | :---: | :---: | :--- | :---: | :---: | :---: | :---: | :--- | :--- |\n`;

    for (const r of rows) {
      const bufferStr = `${r.compressionBufferPct > 0 ? '+' : ''}${r.compressionBufferPct}%`;
      md += `| **\`${r.ticker}\`** | ₹${r.currentPrice} | **${r.trailingPe}x** | ${r.rocePct}% | ${r.engineName} | ₹${r.normalizedCapacityPatCr} Cr | **${r.capacityForwardPe}x** | ${r.exitPe}x | **${bufferStr}** | \`${r.compressionVerdict}\` | \`${r.trancheAction}\` |\n`;
    }

    md += `\n\n### Detailed Stock-by-Stock Engine Breakdown\n\n`;

    for (const r of rows) {
      md += `#### ${r.ticker} — ${r.companyName} (${r.sector})\n`;
      md += `- **Trailing Valuation**: CMP ₹${r.currentPrice} | Mcap ₹${r.mcapCr} Cr | Trailing P/E **${r.trailingPe}x** | ROCE **${r.rocePct}%**\n`;
      md += `- **Primary Engine**: \`${r.engineName}\` (${r.engineType})\n`;
      md += `- **Operational Capacity**: Current Rev ₹${r.currentRevenueCr} Cr $\\to$ Full Capacity Rev ₹${r.fullCapacityRevenueCr} Cr (EBITDA Margin: ${r.normalizedEbitdaMarginPct}%, Net Margin: ${r.normalizedPatMarginPct}%)\n`;
      md += `- **Normalized Full-Capacity PAT**: **₹${r.normalizedCapacityPatCr} Cr**\n`;
      md += `- **Capacity-Adjusted Forward P/E**: **${r.capacityForwardPe}x** (vs Trailing ${r.trailingPe}x)\n`;
      md += `- **ROCE-Tethered Exit Multiple**: **${r.exitPe}x** $\\to$ Scaled Mcap: ₹${r.terminalScaledMcapCr} Cr\n`;
      md += `- **P/E Compression Buffer**: **${r.compressionBufferPct > 0 ? '+' : ''}${r.compressionBufferPct}%** (\`${r.compressionVerdict}\`)\n`;
      md += `- **Capital Deployment Tranche**: \`${r.trancheAction}\` (Authorized Weight: ${r.authorizedWeightPct}%)\n`;
      md += `- **Next Observable Milestone**: *${r.nextPendingMilestone}*\n`;
      md += `- **Filing Grounding Rationale**: ${r.sourceRationale}\n\n`;
    }

    const reportPath = path.resolve('./docs/PORTFOLIO_CAPACITY_VALUATION_BOARD.md');
    fs.writeFileSync(reportPath, md, 'utf-8');
    console.log(`\n📄 Saved detailed report to: ${reportPath}`);

  } catch (err) {
    console.error('❌ Error executing capacity valuation board:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runCapacityValuationBoard();
