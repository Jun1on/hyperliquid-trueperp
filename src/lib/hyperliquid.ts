const API_URL = "https://api.hyperliquid.xyz/info";
const HEADERS = { "Content-Type": "application/json" };
const MAX_PER_REQUEST = 5000;

async function hlPost(payload: object) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(payload),
    next: { revalidate: 0 }, // always fresh from the API route
  });
  if (!res.ok) throw new Error(`Hyperliquid API error: ${res.status}`);
  return res.json();
}

// ── Raw types ─────────────────────────────────────────────────────────────────

interface RawFundingRecord {
  coin: string;
  fundingRate: string;
  premium: string;
  time: number;
}

interface RawCandle {
  t: number; // open time ms
  T: number; // close time ms
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number;
}

// ── Public types (returned to chart) ─────────────────────────────────────────

export interface OhlcPoint {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LinePoint {
  time: number; // unix seconds
  value: number;
}

export interface BarPoint {
  time: number;
  value: number;
}

export interface ChartPayload {
  markCandles: OhlcPoint[];
  adjustedLine: LinePoint[];
  fundingBars: BarPoint[];
  cumulativeLine: LinePoint[];
  meta: {
    coin: string;
    label: string;
    startDate: string;
    endDate: string;
    totalDays: number;
    cumFundingCostPct: number;
    avgAnnRatePct: number;
    pctPositive: number;
  };
}

// ── Fetching ──────────────────────────────────────────────────────────────────

export async function fetchFundingHistory(
  coin: string,
  startMs: number,
  endMs: number
): Promise<RawFundingRecord[]> {
  const all: RawFundingRecord[] = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const data: RawFundingRecord[] = await hlPost({
      type: "fundingHistory",
      coin,
      startTime: cursor,
      endTime: endMs,
    });
    if (!data || data.length === 0) break;
    all.push(...data);
    const lastT = data[data.length - 1].time;
    if (lastT <= cursor || data.length < 2) break;
    cursor = lastT + 1;
    // fundingHistory returns max 500 records per request
    if (data.length < 500) break;
    await sleep(80);
  }
  return all;
}

export async function fetchCandles(
  coin: string,
  interval: string,
  startMs: number,
  endMs: number
): Promise<RawCandle[]> {
  const all: RawCandle[] = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const data: RawCandle[] = await hlPost({
      type: "candleSnapshot",
      req: { coin, interval, startTime: cursor, endTime: endMs },
    });
    if (!data || data.length === 0) break;
    all.push(...data);
    const lastT = data[data.length - 1].t;
    if (lastT <= cursor || data.length < 2) break;
    cursor = lastT + 1;
    if (data.length < MAX_PER_REQUEST) break;
    await sleep(80);
  }
  return all;
}

// ── Computation ───────────────────────────────────────────────────────────────

/**
 * Merges candles + funding history and computes:
 *   - funding-adjusted price (longs pay when rate > 0, so multiplier = prod(1-r))
 *   - annualised funding rate per candle
 *   - cumulative funding cost (%)
 */
export function buildChartPayload(
  coin: string,
  label: string,
  rawCandles: RawCandle[],
  rawFunding: RawFundingRecord[]
): ChartPayload {
  // Deduplicate + sort candles by open time
  const seen = new Set<number>();
  const candles = rawCandles
    .filter((c) => { if (seen.has(c.t)) return false; seen.add(c.t); return true; })
    .sort((a, b) => a.t - b.t);

  // Build funding map: bucket by open time ms -> rate
  // Use merge_asof logic: for each candle, find the latest funding record prior to its time
  const funding = rawFunding
    .map((f) => ({ time: f.time, rate: parseFloat(f.fundingRate) }))
    .sort((a, b) => a.time - b.time);

  function fundingRateAt(candleOpenMs: number): number {
    // Binary search for the largest funding.time <= candleOpenMs
    let lo = 0, hi = funding.length - 1, best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (funding[mid].time <= candleOpenMs) { best = funding[mid].rate; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  }

  // Build series
  const markCandles: OhlcPoint[] = [];
  const adjustedLine: LinePoint[] = [];
  const fundingBars: BarPoint[] = [];
  const cumulativeLine: LinePoint[] = [];

  let cumMultiplier = 1.0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const timeSec = Math.floor(c.t / 1000);
    const close   = parseFloat(c.c);
    const rate    = fundingRateAt(c.t);
    const annRate = rate * 8760; // hourly -> annualised

    // Mark candle
    markCandles.push({
      time: timeSec,
      open: parseFloat(c.o),
      high: parseFloat(c.h),
      low:  parseFloat(c.l),
      close,
    });

    // Funding-adjusted: apply multiplier BEFORE this bar's rate
    // (the multiplier accumulated up to but not including this period)
    adjustedLine.push({ time: timeSec, value: close * cumMultiplier });

    // Funding rate bar (annualised %)
    fundingBars.push({
      time: timeSec,
      value: annRate * 100,
    });

    // Cumulative cost so far (negative = cost to longs)
    cumulativeLine.push({ time: timeSec, value: (cumMultiplier - 1) * 100 });

    // Update multiplier for next bar: longs pay rate each period
    cumMultiplier *= (1 - rate);
  }

  // Summary stats
  const rates = candles.map((c) => fundingRateAt(c.t));
  const avgAnnRate = rates.reduce((s, r) => s + r, 0) / rates.length * 8760 * 100;
  const pctPositive = (rates.filter((r) => r > 0).length / rates.length) * 100;
  const cumCost = (1 - cumMultiplier) * 100; // positive = % paid by longs

  const startDate = new Date(candles[0].t).toISOString().slice(0, 10);
  const endDate   = new Date(candles[candles.length - 1].t).toISOString().slice(0, 10);
  const totalDays = Math.round((candles[candles.length - 1].t - candles[0].t) / 86400000);

  return {
    markCandles,
    adjustedLine,
    fundingBars,
    cumulativeLine,
    meta: { coin, label, startDate, endDate, totalDays, cumFundingCostPct: cumCost, avgAnnRatePct: avgAnnRate, pctPositive },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
