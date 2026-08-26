import { useEffect, useState } from 'react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BOARD, CONFIG, VAULT, connection, sol } from '../lib/state';

type Stats = {
  wordsPlayed: number;
  totalPayoutSol: number;
  totalBurned: number;
  vaultSol: number;
};

export default function GameStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let stop = false;
    const pull = async () => {
      try {
        const conn = connection();
        const [cfg, boardInfo, vault] = await Promise.all([
          conn.getAccountInfo(CONFIG()),
          conn.getAccountInfo(BOARD()),
          conn.getAccountInfo(VAULT()),
        ]);
        if (!cfg || !boardInfo || stop) return;
        const d = cfg.data;
        // layout: authority(32) root(32) entryFee(8) perPoint(8) burnQty(8)
        //         wordsPlayed(8) payout(8) burned(8) ...
        const readU64 = (off: number) => Number(d.readBigUInt64LE(off));
        setStats({
          wordsPlayed: readU64(8 + 64 + 24),
          totalPayoutSol: readU64(8 + 64 + 32) / LAMPORTS_PER_SOL,
          totalBurned: readU64(8 + 64 + 40),
          vaultSol: (vault?.lamports ?? 0) / LAMPORTS_PER_SOL,
        });
      } catch (e) {
        console.warn('stats', e);
      }
    };
    pull();
    const iv = setInterval(pull, 15_000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, []);

  return (
    <div className="panel">
      <h3>Table Stats</h3>
      {!stats ? (
        <span>Loading on-chain state… (is the game initialized?)</span>
      ) : (
        <>
          <div className="statline"><span>Words played</span><b>{stats.wordsPlayed.toLocaleString()}</b></div>
          <div className="statline"><span>Total paid out</span><b>{sol(stats.totalPayoutSol)}</b></div>
          <div className="statline"><span>Tokens burned</span><b>{stats.totalBurned.toLocaleString()}</b></div>
          <div className="statline"><span>Vault balance</span><b>{sol(stats.vaultSol)}</b></div>
          <div className="statline mono" style={{ fontSize: 11 }}>
            <span>vault</span><span>{VAULT().toBase58().slice(0, 12)}…</span>
          </div>
        </>
      )}
    </div>
  );
}
