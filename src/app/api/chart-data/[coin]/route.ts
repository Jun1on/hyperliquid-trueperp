import { NextRequest, NextResponse } from "next/server";
import { fetchFundingHistory, fetchCandles, buildChartPayload } from "@/lib/hyperliquid";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ coin: string }> }
) {
  const coin = decodeURIComponent((await params).coin);
  const { searchParams } = request.nextUrl;
  const days = parseInt(searchParams.get("days") ?? "0") || 0;

  const nowMs = Date.now();
  const startMs = days > 0 ? nowMs - days * 86_400_000 : nowMs - 2 * 365 * 86_400_000;

  try {
    const [rawFunding, rawCandles] = await Promise.all([
      fetchFundingHistory(coin, startMs, nowMs),
      fetchCandles(coin, "1h", startMs, nowMs),
    ]);

    if (rawCandles.length === 0) {
      return NextResponse.json(
        { error: `No candle data for coin '${coin}'. Make sure the coin identifier is correct (e.g. BTC, ETH, vntl:ANTHROPIC).` },
        { status: 404 }
      );
    }

    const payload = buildChartPayload(coin, coin, rawCandles, rawFunding);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" },
    });
  } catch (err) {
    console.error("[chart-data]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
