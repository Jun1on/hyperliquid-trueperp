"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./home.module.css";

export default function Home() {
  const [coin, setCoin] = useState("");
  const router = useRouter();

  function go() {
    const trimmed = coin.trim();
    if (trimmed) router.push(`/${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <h1 className={styles.title}>trueperp</h1>
        <p className={styles.subtitle}>
          Funding-adjusted price charts for Hyperliquid perpetuals.
          <br />
          See the true long ROI with funding costs baked in.
        </p>

        <div className={styles.inputRow}>
          <input
            className={styles.input}
            placeholder="e.g. BTC, ETH, vntl:ANTHROPIC"
            value={coin}
            onChange={(e) => setCoin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            autoFocus
          />
          <button className={styles.goBtn} onClick={go}>View chart</button>
        </div>

        <div className={styles.examples}>
          <span className={styles.exLabel}>Try:</span>
          {["BTC", "ETH", "SOL", "vntl:ANTHROPIC"].map((c) => (
            <button key={c} className={styles.exBtn} onClick={() => router.push(`/${encodeURIComponent(c)}`)}>
              {c}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
