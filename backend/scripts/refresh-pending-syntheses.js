/** Backed-up, one-stock-at-a-time regeneration of reports after a corrected verified results filing. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pool} from '../db/pool.js';
import {currentSyntheses} from '../services/synthesis-freshness.service.js';
import {generateInstitutionalSyntheses} from '../workers/quarterly-deepdive-worker.js';

async function main(){
 const args=process.argv.slice(2),apply=args.includes('--apply');
 const idx=args.indexOf('--limit'),limit=idx<0?1:Number(args[idx+1]);
 const tickerAt=args.indexOf('--ticker'),ticker=tickerAt<0?null:String(args[tickerAt+1]||'').trim().toUpperCase();
 if(tickerAt>=0&&!/^[A-Z0-9]{2,20}$/.test(ticker))throw new Error('--ticker needs an exact stock ticker');
 if(!Number.isInteger(limit)||limit<1||limit>10)throw new Error('--limit must be 1..10; default is one stock');
 const {rows:candidates}=await pool.query(`SELECT s.id,s.ticker,qs.raw_ai_output->'source_filing'->>'announcement_id' AS source_id
 FROM stocks s JOIN LATERAL (SELECT raw_ai_output,quarter FROM quarterly_snapshots q WHERE q.stock_id=s.id AND q.raw_ai_output->'verified_financials'->>'isFinancialResult'='true' ORDER BY COALESCE((substring(quarter from 'FY([0-9]{2})')::integer*100+substring(quarter from 'Q([1-4])')::integer),0) DESC,created_at DESC LIMIT 1) qs ON true
 JOIN corporate_announcements ca ON ca.id::text=qs.raw_ai_output->'source_filing'->>'announcement_id' AND ca.stock_id=s.id
 WHERE s.category IN ('Core','Watchlist') AND ca.event_analysis->>'repair_followups_pending'='true'
 AND COALESCE(ca.event_analysis->>'foreign_filing','false')<>'true' ORDER BY s.ticker`);
 const {rows:templates}=await pool.query('SELECT name FROM prompt_templates ORDER BY name');
 const selected=[];
 for(const stock of candidates.filter(s=>!ticker||s.ticker===ticker)){
  const {rows:reports}=await pool.query('SELECT * FROM stock_syntheses WHERE stock_id=$1 ORDER BY prompt_name',[stock.id]);
  const fresh=currentSyntheses(reports,stock.source_id);
  if(templates.every(t=>fresh.some(r=>r.prompt_name===t.name)))continue;
  selected.push({...stock,reports,oldCurrent:fresh.length});
  if(selected.length>=limit)break;
 }
 console.log(JSON.stringify({selected:selected.map(({ticker,source_id,oldCurrent,reports})=>({ticker,sourceId:source_id,current:oldCurrent,total:reports.length})),expectedReports:templates.length},null,2));
 if(!apply){console.log('[DRY RUN] No LLM calls or writes. --apply backs up the reports, then regenerates one stock at a time.');return;}
 if(!selected.length)return;
 const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../scratch');fs.mkdirSync(dir,{recursive:true});
 const backupPath=path.join(dir,`pending-syntheses-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
 const backup={selected,expectedPromptNames:templates.map(t=>t.name),completedTickers:[],remainingTickers:selected.map(s=>s.ticker)};
 fs.writeFileSync(backupPath,JSON.stringify(backup,null,2));console.log(`[APPLY] Backup written to ${backupPath}`);
 for(let i = 0; i < selected.length; i++){
  const stock = selected[i];
  if (i > 0) {
    console.log(`[PACE] Waiting 10 seconds before next stock synthesis to respect Gemini/LLM rate limits...`);
    await new Promise(r => setTimeout(r, 10000));
  }
  await generateInstitutionalSyntheses(stock.ticker,true);
  const {rows:reports}=await pool.query('SELECT prompt_name,report_content FROM stock_syntheses WHERE stock_id=$1',[stock.id]);
  const current=currentSyntheses(reports,stock.source_id);
  if(!templates.every(t=>current.some(r=>r.prompt_name===t.name))){console.warn(`[DEFERRED] ${stock.ticker}: only ${current.length}/${templates.length} reports match source ${stock.source_id}. Stop before the next stock.`);process.exitCode=2;break;}
  backup.completedTickers.push(stock.ticker);backup.remainingTickers=selected.map(s=>s.ticker).filter(t=>!backup.completedTickers.includes(t));
  fs.writeFileSync(backupPath,JSON.stringify(backup,null,2));
  console.log(`[VERIFIED] ${stock.ticker}: ${current.length}/${templates.length} reports have current source ID.`);
 }
 console.log(JSON.stringify({backupPath,completedTickers:backup.completedTickers,remainingTickers:backup.remainingTickers},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
