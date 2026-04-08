import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "trueperp — Funding-Adjusted Perpetual Charts",
  description: "See the true ROI of Hyperliquid perpetuals with funding costs baked into the price chart.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
