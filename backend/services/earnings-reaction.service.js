/** Measured event-window returns. No company rules, consensus guesses or trading signals. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const sessionOverrides = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../config/market-sessions.json'), 'utf8'));
const positive = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const pct = (end, start) => 100 * (end / start - 1);
const unavailable = reason => ({ status: 'UNAVAILABLE', reason, consensus: 'UNKNOWN' });
const isoTimestamp = value => value instanceof Date ? value : typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? new Date(value) : new Date(NaN);
export const indiaDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

function sessionFor(date, overrides) {
  const s = overrides[date] || { open: '09:15:00', close: '15:30:00', complete: '16:00:00' };
  // Completion conservatively includes post-close. Provider bar timestamp is NOT its open time.
  return { ...s, opensAt: new Date(`${date}T${s.open}+05:30`), closesAt: new Date(`${date}T${s.close}+05:30`), completeAt: new Date(`${date}T${s.complete || s.close}+05:30`) };
}

function validateBars(input) {
  if (!Array.isArray(input)) throw new Error('Missing history');
  const seen = new Set();
  return input.map(b => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !Number.isFinite(Date.parse(`${b.date}T00:00:00Z`)) || !positive(b.close) || !positive(b.adjustedClose) || seen.has(b.date)) throw new Error('Invalid, unadjusted or duplicate daily bar');
    seen.add(b.date);
    return b;
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export function analyseEarningsReaction({ publishedAt, bars, benchmarkBars = [], now = new Date(), sessions = sessionOverrides } = {}) {
  const event = isoTimestamp(publishedAt);
  if (!Number.isFinite(event.getTime()) || !Number.isFinite(now.getTime()) || event > now) return unavailable('Invalid or future filing timestamp; timezone required');
  let series, benchmark;
  try { series = validateBars(bars); benchmark = validateBars(benchmarkBars); }
  catch (err) { return unavailable(err.message); }
  // Actual bars define sessions: do not filter out genuine weekend trading.
  series = series.filter(b => b.complete !== false && sessionFor(b.date, sessions).completeAt <= now);
  benchmark = benchmark.filter(b => b.complete !== false && sessionFor(b.date, sessions).completeAt <= now);
  if (benchmark.at(-1)?.date > series.at(-1)?.date) return unavailable('Stock history is missing the latest benchmark session');
  if (series.length && (now - new Date(`${series.at(-1).date}T00:00:00Z`)) / 86400000 > 4) return unavailable('Market history is stale');
  const firstIndex = series.findIndex(b => sessionFor(b.date, sessions).closesAt > event);
  // No completed reaction bar yet: baseline is still the last pre-event close.
  const baselineIndex = firstIndex < 0 ? series.length - 1 : firstIndex - 1;
  const baseline = series[baselineIndex];
  if (!baseline || sessionFor(baseline.date, sessions).closesAt > event) return unavailable('No pre-release baseline close in history');
  const dates = new Set(series.map(b => b.date));
  if (benchmark.some(b => b.date > baseline.date && b.date <= series.at(-1)?.date && !dates.has(b.date))) return unavailable('Stock history has missing benchmark sessions; event window cannot be counted reliably');
  const post = firstIndex < 0 ? [] : series.slice(firstIndex);
  const benchmarkMap = new Map(benchmark.map(b => [b.date, b]));
  const baselineBenchmark = benchmarkMap.get(baseline.date);
  const measure = b => {
    const bm = benchmarkMap.get(b.date);
    const returnPct = pct(b.adjustedClose, baseline.adjustedClose);
    const benchmarkReturnPct = bm && baselineBenchmark ? pct(bm.adjustedClose, baselineBenchmark.adjustedClose) : null;
    return { status: 'OBSERVED', date: b.date, close: b.close, returnPct, benchmarkReturnPct, excessReturnPp: benchmarkReturnPct === null ? null : returnPct - benchmarkReturnPct };
  };
  const flags = ['OBSERVED_ASSOCIATION_NOT_CAUSATION', 'CONSENSUS_EXPECTATIONS_UNKNOWN'];
  const first = post[0];
  const firstSession = first && sessionFor(first.date, sessions);
  if (firstSession && event >= firstSession.opensAt) flags.push('INTRADAY_RELEASE_MIXED_DAILY_BAR');
  if (post.some(b => sessionFor(b.date, sessions).shortSession)) flags.push('SHORT_SESSION_VOLUME_NOT_COMPARABLE');
  if (post.length < 3) flags.push('EARLY_REACTION');
  const latest = post.at(-1);
  const previous = series.at(-2);
  const runup = n => baselineIndex >= n ? pct(baseline.adjustedClose, series[baselineIndex - n].adjustedClose) : null;
  const volumeHistory = series.slice(Math.max(0, baselineIndex - 19), baselineIndex + 1);
  const comparableVolume = volumeHistory.length === 20 && volumeHistory.every(b => Number.isFinite(b.volume) && b.volume > 0 && !sessionFor(b.date, sessions).shortSession)
    && first && Number.isFinite(first.volume) && first.volume > 0 && !firstSession.shortSession
    && volumeHistory.every(b => Math.abs(b.adjustedClose / b.close - first.adjustedClose / first.close) < 0.0001);
  const sortedVolume = comparableVolume ? volumeHistory.map(b => b.volume).sort((a, b) => a - b) : [];
  const medianVolume = comparableVolume ? (sortedVolume[9] + sortedVolume[10]) / 2 : null;
  return {
    version: 1, status: post.length ? 'OBSERVED' : 'PENDING', publishedAt: event.toISOString(), asOf: now.toISOString(),
    baseline: { date: baseline.date, close: baseline.close, adjustedClose: baseline.adjustedClose }, sessionsObserved: post.length,
    windows: Object.fromEntries([1, 3, 5].map(n => [`D${n}`, post[n - 1] ? measure(post[n - 1]) : { status: 'PENDING', sessionsRequired: n }])),
    latest: latest ? measure(latest) : null,
    latestSession: latest && previous ? { date: latest.date, returnPct: pct(latest.adjustedClose, previous.adjustedClose) } : null,
    firstGapPct: first && positive(first.open) ? pct(first.open * first.adjustedClose / first.close, baseline.adjustedClose) : null,
    firstOpenToClosePct: first && positive(first.open) ? pct(first.close, first.open) : null,
    preResultRunup5Pct: runup(5), preResultRunup20Pct: runup(20),
    worstCloseReturnPct: post.length ? Math.min(...post.map(b => pct(b.adjustedClose, baseline.adjustedClose))) : null,
    firstRelativeVolume: medianVolume ? first.volume / medianVolume : null,
    consensus: 'UNKNOWN', flags,
    interpretation: 'Price behaviour is separate evidence. Reconcile with verified earnings, cash conversion, guidance and fresh valuation before changing exposure.'
  };
}

export function parseReactionChart(data, expectedSymbol) {
  const r = data?.chart?.result?.[0];
  if (!r || data.chart.error || r.meta?.symbol?.toUpperCase() !== expectedSymbol.toUpperCase() || r.meta.exchangeTimezoneName !== 'Asia/Kolkata') throw new Error('History identity/timezone mismatch');
  const q = r.indicators?.quote?.[0];
  const adj = r.indicators?.adjclose?.[0]?.adjclose;
  if (!Array.isArray(adj)) throw new Error('Adjusted price history missing');
  const bars = (r.timestamp || []).map((t, i) => ({ date: indiaDate(new Date(t * 1000)), open: q?.open?.[i], high: q?.high?.[i], low: q?.low?.[i], close: q?.close?.[i], adjustedClose: adj[i], volume: q?.volume?.[i] }));
  validateBars(bars);
  if (!bars.length) throw new Error('History empty');
  return { symbol: r.meta.symbol, bars, corporateActions: r.events || {}, source: 'YAHOO_CHART_ADJUSTED', adjustmentBasis: 'PROVIDER_ADJUSTED_CLOSE' };
}

/** One shared benchmark request; bounded concurrency/cache, request coalescing and global quota pause. */
export function createReactionHistoryClient({ fetcher = (...args) => fetch(...args), clock = Date.now, timeoutMs = 4000, ttlMs = 600000, maxEntries = 128, concurrency = 2 } = {}) {
  const cache = new Map(), inFlight = new Map();
  let active = 0, cooldownUntil = 0;
  async function get(symbol) {
    if (!/^[A-Z0-9^&_.-]{1,40}$/i.test(symbol)) throw new Error('Invalid provider symbol');
    const cached = cache.get(symbol);
    if (cached && clock() - cached.time < ttlMs) return cached.value;
    if (inFlight.has(symbol)) return inFlight.get(symbol);
    if (clock() < cooldownUntil) throw new Error('Market history provider cooldown');
    if (active >= concurrency) throw new Error('Market history provider busy; deferred');
    active++;
    const task = (async () => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo&events=div%2Csplits`;
      const controller = new AbortController();
      let timer;
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Market history deadline exceeded')); }, timeoutMs); });
      const request = (async () => {
      const response = await fetcher(url, { headers: { 'User-Agent': 'ThesisIQ/1.0' }, signal: controller.signal });
      if (!response.ok) {
        if (response.status === 429) {
          const retry = response.headers?.get('retry-after');
          const seconds = Number(retry);
          const delay = retry && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - clock();
          cooldownUntil = clock() + Math.max(60000, Number.isFinite(delay) ? delay : 60000);
        }
        throw Object.assign(new Error(`Market history HTTP ${response.status}`), { status: response.status });
      }
      return parseReactionChart(await response.json(), symbol);
      })();
      let parsed;
      try { parsed = await Promise.race([request, deadline]); } finally { clearTimeout(timer); }
      const value = { ...parsed, fetchedAt: new Date(clock()).toISOString(), sourceUrl: url };
      cache.delete(symbol);
      cache.set(symbol, { time: clock(), value });
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return value;
    })();
    inFlight.set(symbol, task);
    try { return await task; } finally { active--; inFlight.delete(symbol); }
  }
  return { get };
}

const historyClient = createReactionHistoryClient();
export async function loadEarningsReaction({ ticker, nseSymbol, publishedAt, now = new Date(), client = historyClient, benchmarkSymbol = '^CRSLDX' }) {
  try {
    const getStock = async () => {
      const candidates = [...new Set([ticker, nseSymbol].filter(Boolean))];
      for (let i = 0; i < candidates.length; i++) {
        try { return await client.get(`${candidates[i]}.NS`); }
        catch (err) { if (err.status !== 404 || i === candidates.length - 1) throw err; }
      }
      throw new Error('Market history stock identity missing');
    };
    const [stock, benchmark] = await Promise.allSettled([getStock(), client.get(benchmarkSymbol)]);
    if (stock.status !== 'fulfilled') throw stock.reason;
    const reaction = analyseEarningsReaction({ publishedAt, now, bars: stock.value.bars, benchmarkBars: benchmark.status === 'fulfilled' ? benchmark.value.bars : [] });
    if (benchmark.status !== 'fulfilled' && reaction.flags) reaction.flags.push('BENCHMARK_UNAVAILABLE');
    return { ...reaction, provenance: { stock: { ...stock.value, bars: undefined }, benchmark: benchmark.status === 'fulfilled' ? { ...benchmark.value, bars: undefined } : null } };
  } catch (err) {
    console.warn(`[REACTION] ${ticker}: ${err.message}`);
    return unavailable(err.message);
  }
}

export function formatReactionContext(r) {
  if (!r) return '';
  if (r.status === 'UNAVAILABLE') return 'Market reaction unavailable; no price inference.';
  if (r.status === 'PENDING') return 'Market reaction pending the first completed post-release session; expectations unknown.';
  const fmt = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
  const windows = [1, 3, 5].map(n => { const w = r.windows[`D${n}`]; return w.status === 'OBSERVED' ? `D${n} ${fmt(w.returnPct)}` : `D${n} pending`; });
  const excess = r.latest.excessReturnPp;
  return `Market reaction (from ${r.baseline.date} close): ${windows.join(' · ')}. Latest ${fmt(r.latest.returnPct)} through ${r.latest.date}${excess === null ? '; benchmark unavailable' : `; vs Nifty 500 ${excess >= 0 ? '+' : ''}${excess.toFixed(2)} pp`}. Consensus expectations unknown.${r.flags.includes('INTRADAY_RELEASE_MIXED_DAILY_BAR') ? ' Intraday release: daily bar mixes pre/post news.' : ''}${r.flags.includes('SHORT_SESSION_VOLUME_NOT_COMPARABLE') ? ' Includes short session; volume not comparable.' : ''} Price alone does not change the fundamental verdict.`;
}
