import FundingChart from "@/components/FundingChart";

interface Props {
  params: Promise<{ coin: string }>;
}

export async function generateMetadata({ params }: Props) {
  const coin = decodeURIComponent((await params).coin);
  return {
    title: `${coin} — Funding-Adjusted Chart | trueperp`,
    description: `Interactive funding-adjusted price history for ${coin} perpetual on Hyperliquid.`,
  };
}

export default async function CoinPage({ params }: Props) {
  const coin = decodeURIComponent((await params).coin);
  return <FundingChart coin={coin} />;
}
