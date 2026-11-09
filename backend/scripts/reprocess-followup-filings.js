/** Backed-up, Telegram-suppressed replay for decks, press releases and transcripts after their results are corrected. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pool} from '../db/pool.js';
import {processPendingDeepDives} from '../workers/quarterly-deepdive-worker.js';
import {parseRepairIds} from './reprocess-results-snapshots.js';

/** Snapshot all stock-scoped rows that a follow-up worker may update or insert. */
export async function captureFollowupState(rows) {
 const stockIds=[...new Set(rows.map(r=>r.stock_id).filter(Boolean))];
 const tickers=[...new Set(rows.map(r=>r.ticker).filter(Boolean))];
 const scope={stockIds,tickers,announcementIds:rows.map(r=>r.id)};
 const queries={
  corporate_announcements:['SELECT * FROM corporate_announcements WHERE ticker=ANY($1::text[])',[tickers]],
  management_commitments:['SELECT * FROM management_commitments WHERE stock_id=ANY($1::uuid[])',[stockIds]],
  quarterly_snapshots:['SELECT * FROM quarterly_snapshots WHERE stock_id=ANY($1::uuid[])',[stockIds]],
  guidance_outcomes:['SELECT * FROM guidance_outcomes WHERE ticker=ANY($1::text[])',[tickers]],
  guidance_pacing_history:['SELECT * FROM guidance_pacing_history WHERE ticker=ANY($1::text[])',[tickers]],
  stock_syntheses:['SELECT * FROM stock_syntheses WHERE stock_id=ANY($1::uuid[])',[stockIds]]
 };
 const tables={};
 for(const [table,[sql,params]] of Object.entries(queries)) tables[table]=(await pool.query(sql,params)).rows;
 return {capturedAt:new Date().toISOString(),scope,tables};
}

/** One filing per worker invocation; a quota deferral stops the entire repair batch. */
export async function replayFollowupIds(ids, {run=processPendingDeepDives, wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)), paceMs=60000}={}) {
 const aggregate={processed:0,failed:0,processedIds:[],runs:[],stoppedOn:null};
 for(let i=0;i<ids.length;i++) {
  const id=ids[i];
  const result=await run({announcementIds:[id],suppressTelegram:true,skipOptionalWork:true,batchSize:1});
  aggregate.runs.push({id,result});
  aggregate.processed+=result.processed||0;
  aggregate.failed+=result.failed||0;
  if(!result.processedIds?.includes(id)) {aggregate.stoppedOn=id;break;}
  aggregate.processedIds.push(id);
  if(i<ids.length-1) await wait(paceMs);
 }
 return aggregate;
}

/** Completion requires a verdict produced by this run and grounded in its own extracted source. */
export function completedFollowupIds(ids, result, after) {
 return after.filter(row => ids.includes(row.id) && result.processedIds?.includes(row.id) &&
  row.deep_dive_status==='completed' && row.action &&
  row.source_document?.announcement_id===row.id &&
  /^[a-f0-9]{64}$/i.test(String(row.source_document?.text_sha256 || '')) &&
  (!row.attachment_url || row.source_document?.attachment_url===row.attachment_url)).map(row=>row.id);
}

async function main() {
 const args=process.argv.slice(2), ids=parseRepairIds(args), apply=args.includes('--apply');
 const {rows}=await pool.query(`SELECT ca.* FROM corporate_announcements ca WHERE ca.id=ANY($1::uuid[]) ORDER BY ca.ticker,ca.filing_date`,[ids]);
 if(rows.length!==ids.length)throw new Error('Some selected IDs are missing; no replay started');
 if(rows.some(r=>r.event_analysis?.foreign_filing===true || r.event_analysis?.foreign_filing==='true'))throw new Error('Foreign filing selected; no replay started');
 if(rows.some(r=>r.event_analysis?.institutional_verdict?.verified_financials))throw new Error('A results source was selected; use the results repair runner');
 console.log(JSON.stringify({selected:rows.map(r=>({id:r.id,ticker:r.ticker,title:r.title,date:r.filing_date,previousAction:r.event_analysis?.institutional_verdict?.final_action}))},null,2));
 if(!apply){console.log('[DRY RUN] No writes, OCR, LLM or Telegram.');return;}
 const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../scratch');fs.mkdirSync(dir,{recursive:true});
 const backupPath=path.join(dir,`followup-replay-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
 const before=await captureFollowupState(rows);
 fs.writeFileSync(backupPath,JSON.stringify({before,targetIds:ids,completedIds:[],remainingIds:ids},null,2),{flag:'wx'});
 console.log(`[APPLY] Backup written to ${backupPath}`);
 const result=await replayFollowupIds(ids);
 const {rows:after}=await pool.query(`SELECT id,ticker,attachment_url,deep_dive_status,event_analysis->'institutional_verdict'->>'final_action' AS action,event_analysis->'institutional_verdict'->'source_document' AS source_document FROM corporate_announcements WHERE id=ANY($1::uuid[])`,[ids]);
 const completedIds=completedFollowupIds(ids,result,after);
 const remainingIds=ids.filter(id=>!completedIds.includes(id));
 const afterState=await captureFollowupState(rows);
 const reportPath=backupPath.replace('-backup-','-report-');
 fs.writeFileSync(reportPath,JSON.stringify({backupPath,after:afterState,targetIds:ids,completedIds,remainingIds,result},null,2),{flag:'wx'});
 console.log(`[APPLY] Post-replay audit written to ${reportPath}`);
 console.log(JSON.stringify({processed:result.processed,failed:result.failed,completed:after.filter(r=>completedIds.includes(r.id)),remainingIds},null,2));
 if(remainingIds.length)process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
