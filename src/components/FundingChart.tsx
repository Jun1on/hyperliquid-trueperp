"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  LogicalRange,
} from "lightweight-charts";
import type { ChartPayload, LinePoint, BarPoint } from "@/lib/hyperliquid";
import styles from "./FundingChart.module.css";

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  bg:         "#0d1117",
  panel:      "#0d1117",
  border:     "#21262d",
  text:       "#e6edf3",
  textMuted:  "#8b949e",
  blue:       "#58a6ff",
  green:      "#3fb950",
  red:        "#f85149",
  purple:     "#bc8cff",
  orange:     "#d29922",
};

const COMMON_OPTS = {
  layout: {
    background: { type: ColorType.Solid, color: C.panel },
    textColor: C.text,
    fontFamily: "'Inter', 'DejaVu Sans', sans-serif",
    fontSize: 12,
  },
  grid: {
    vertLines: { color: C.border },
    horzLines: { color: C.border },
  },
  crosshair: { mode: CrosshairMode.Normal },
  timeScale: {
    borderColor: C.border,
    timeVisible: true,
    secondsVisible: false,
  },
  rightPriceScale: { borderColor: C.border },
};

// ── Lookback options ──────────────────────────────────────────────────────────
const LOOKBACK_OPTIONS = [
  { label: "7D",  days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "All", days: 0 },
];

interface Props {
  coin: string; // URL slug, e.g. "ANTHROPIC"
}

export default function FundingChart({ coin }: Props) {
  const priceRef   = useRef<HTMLDivElement>(null);
  const fundRef    = useRef<HTMLDivElement>(null);
  const cumRef     = useRef<HTMLDivElement>(null);

  const priceChart  = useRef<IChartApi | null>(null);
  const fundChart   = useRef<IChartApi | null>(null);
  const cumChart    = useRef<IChartApi | null>(null);

  const [data,    setData]    = useState<ChartPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [days,    setDays]    = useState(0); // 0 = all
  const [hoveredRate, setHoveredRate] = useState<number | null>(null);

  // ── Sync time scales of all three charts ─────────────────────────────────
  const isSyncing = useRef(false);

  function syncRange(source: IChartApi, targets: IChartApi[]) {
    source.timeScale().subscribeVisibleLogicalRangeChange((range: LogicalRange | null) => {
      if (isSyncing.current || !range) return;
      isSyncing.current = true;
      targets.forEach((t) => t.timeScale().setVisibleLogicalRange(range));
      isSyncing.current = false;
    });
  }

  // ── Fetch data ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = days > 0 ? `?days=${days}` : "";
      const res = await fetch(`/api/chart-data/${coin}${qs}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [coin, days]);

  useEffect(() => { load(); }, [load]);

  // ── Build / update charts when data changes ────────────────────────────────
  useEffect(() => {
    if (!data || !priceRef.current || !fundRef.current || !cumRef.current) return;

    // Destroy old charts
    priceChart.current?.remove();
    fundChart.current?.remove();
    cumChart.current?.remove();

    // ── Price chart ──────────────────────────────────────────────────────────
    const pc = createChart(priceRef.current, {
      ...COMMON_OPTS,
      height: 420,
      width: priceRef.current.clientWidth,
    });
    priceChart.current = pc;

    // Mark price candlesticks
    const markSeries = pc.addSeries(CandlestickSeries, {
      upColor:        C.blue,
      downColor:      "#1c4f8c",
      borderUpColor:  C.blue,
      borderDownColor:"#1c4f8c",
      wickUpColor:    C.blue,
      wickDownColor:  "#1c4f8c",
    });
    markSeries.setData(data.markCandles as any);

    // Funding-adjusted line
    const adjSeries = pc.addSeries(LineSeries, {
      color:       C.green,
      lineWidth:   2,
      priceLineVisible: false,
      lastValueVisible: true,
      title:       "adj",
    });
    adjSeries.setData(data.adjustedLine as any);

    // ── Funding rate chart ───────────────────────────────────────────────────
    const fc = createChart(fundRef.current, {
      ...COMMON_OPTS,
      height: 160,
      width: fundRef.current.clientWidth,
      timeScale: { ...COMMON_OPTS.timeScale, visible: false },
    });
    fundChart.current = fc;

    const fundSeries = fc.addSeries(HistogramSeries, {
      priceFormat:      { type: "custom", formatter: (v: number) => `${v.toFixed(0)}%/yr` },
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Clip extreme spikes at 2x p95 for display
    const absVals = data.fundingBars.map((b: BarPoint) => Math.abs(b.value));
    absVals.sort((a: number, b: number) => a - b);
    const p95 = absVals[Math.floor(absVals.length * 0.95)] ?? 1;
    const clip = Math.max(p95 * 2, 1);
    const clippedBars = data.fundingBars.map((b: BarPoint) => ({
      ...b,
      value: Math.min(Math.max(b.value, -clip), clip),
      color: b.value >= 0 ? C.green : C.red,
    }));
    fundSeries.setData(clippedBars as any);

    // Subscribe crosshair to show rate in header
    fc.subscribeCrosshairMove((param) => {
      if (param.seriesData.has(fundSeries)) {
        const d = param.seriesData.get(fundSeries) as { value: number } | undefined;
        setHoveredRate(d?.value ?? null);
      } else {
        setHoveredRate(null);
      }
    });

    // ── Cumulative funding chart ─────────────────────────────────────────────
    const cc = createChart(cumRef.current, {
      ...COMMON_OPTS,
      height: 140,
      width: cumRef.current.clientWidth,
    });
    cumChart.current = cc;

    const cumSeries = cc.addSeries(LineSeries, {
      color:       C.purple,
      lineWidth:   2,
      priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(2)}%` },
      priceLineVisible: false,
      lastValueVisible: true,
    });
    cumSeries.setData(data.cumulativeLine as any);

    // Baseline at 0
    cumSeries.createPriceLine({ price: 0, color: C.border, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });

    // ── Sync all three ───────────────────────────────────────────────────────
    syncRange(pc, [fc, cc]);
    syncRange(fc, [pc, cc]);
    syncRange(cc, [pc, fc]);

    pc.timeScale().fitContent();

    // ── Resize observer ──────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (priceRef.current) pc.applyOptions({ width: priceRef.current.clientWidth });
      if (fundRef.current)  fc.applyOptions({ width: fundRef.current.clientWidth });
      if (cumRef.current)   cc.applyOptions({ width: cumRef.current.clientWidth });
    });
    if (priceRef.current) ro.observe(priceRef.current);
    if (fundRef.current)  ro.observe(fundRef.current);
    if (cumRef.current)   ro.observe(cumRef.current);

    return () => {
      ro.disconnect();
      pc.remove(); fc.remove(); cc.remove();
      priceChart.current = null;
      fundChart.current  = null;
      cumChart.current   = null;
    };
  }, [data]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const meta = data?.meta;
  const cumCost = meta ? meta.cumFundingCostPct : 0;
  const cumColor = cumCost > 0 ? C.red : C.green;

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{meta?.label ?? coin}</h1>
          <span className={styles.subtitle}>Funding-Adjusted Price  ·  Hyperliquid Perpetual</span>
        </div>

        {meta && (
          <div className={styles.stats}>
            <Stat label="Period" value={`${meta.startDate} → ${meta.endDate}`} />
            <Stat label="Cum. funding cost (long)"
                  value={`${cumCost > 0 ? "+" : ""}${cumCost.toFixed(2)}%`}
                  color={cumColor} />
            <Stat label="Avg rate (ann.)"
                  value={`${meta.avgAnnRatePct.toFixed(1)}%/yr`} />
            <Stat label="% hours positive"
                  value={`${meta.pctPositive.toFixed(1)}%`} />
          </div>
        )}
      </div>

      {/* Lookback picker */}
      <div className={styles.toolbar}>
        <div className={styles.lookbackGroup}>
          {LOOKBACK_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              className={`${styles.lookbackBtn} ${days === opt.days ? styles.lookbackBtnActive : ""}`}
              onClick={() => setDays(opt.days)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className={styles.legend}>
          <LegendItem color={C.blue}   label="Mark price" />
          <LegendItem color={C.green}  label="Funding-adjusted (long ROI)" />
        </div>
      </div>

      {/* Charts */}
      {loading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Fetching data from Hyperliquid…</span>
        </div>
      )}
      {error && (
        <div className={styles.error}>Error: {error}</div>
      )}
      {!loading && !error && (
        <>
          {/* Price + adjusted */}
          <div className={styles.chartPanel}>
            <div className={styles.chartLabel}>Price (USDH)</div>
            <div ref={priceRef} />
          </div>

          {/* Funding rate */}
          <div className={styles.chartPanel}>
            <div className={styles.chartLabel}>
              Funding rate (ann.%)
              {hoveredRate !== null && (
                <span style={{ color: hoveredRate >= 0 ? C.green : C.red, marginLeft: 8 }}>
                  {hoveredRate >= 0 ? "+" : ""}{hoveredRate.toFixed(1)}%/yr
                </span>
              )}
            </div>
            <div ref={fundRef} />
          </div>

          {/* Cumulative funding */}
          <div className={styles.chartPanel}>
            <div className={styles.chartLabel}>Cumulative funding cost (long paid)</div>
            <div ref={cumRef} />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue} style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className={styles.legendItem}>
      <span className={styles.legendDot} style={{ background: color }} />
      {label}
    </span>
  );
}
