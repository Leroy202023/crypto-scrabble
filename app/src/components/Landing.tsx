import { useEffect, useState } from 'react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BOARD, CONFIG, VAULT, connection, getProgramId } from '../lib/state';

type Stats = {
  wordsPlayed: number;
  totalPayoutSol: number;
  totalBurned: number;
  vaultSol: number;
};

/** Live on-chain totals (same layout decode as GameStats). */
function useChainStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    let stop = false;
    const pull = async () => {
      try {
        const conn = connection();
        const [cfg, vault] = await Promise.all([
          conn.getAccountInfo(CONFIG()),
          conn.getAccountInfo(VAULT()),
        ]);
        if (!cfg || stop) return;
        const d = cfg.data;
        const readU64 = (off: number) => Number(d.readBigUInt64LE(off));
        setStats({
          wordsPlayed: readU64(8 + 64 + 24),
          totalPayoutSol: readU64(8 + 64 + 32) / LAMPORTS_PER_SOL,
          totalBurned: readU64(8 + 64 + 40),
          vaultSol: (vault?.lamports ?? 0) / LAMPORTS_PER_SOL,
        });
      } catch {
        /* stats are decorative on landing */
      }
    };
    pull();
    const iv = setInterval(pull, 15_000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, []);
  return stats;
}

const STEPS = [
  {
    n: '01',
    title: 'Get your letters',
    body: 'Every letter is its own Token-2022 mint with a fixed, scarce supply — E is common, Z is rare, prices follow scarcity. On mainnet they trade on Jupiter; during the devnet beta the operator issues starter racks.',
  },
  {
    n: '02',
    title: 'Play real words',
    body: 'Place tiles on the 15×15 board. Cross-words count, premium squares multiply, and every word is proven against a 172k-word dictionary with SHA-256 merkle proofs.',
  },
  {
    n: '03',
    title: 'Burn & bank SOL',
    body: 'Each new tile burns letter tokens forever. Your score is paid out in SOL from the on-chain vault the moment your play confirms — no claims, no waiting.',
  },
];

const RECEIPT = [
  { label: 'OSO · main word', note: 'O on DL ×2', pts: 5 },
  { label: 'CO · cross', note: 'O on DL ×2', pts: 5 },
  { label: 'AS · cross', note: '', pts: 2 },
  { label: 'TO · cross', note: 'O on DL ×2', pts: 3 },
];

export default function Landing({ onPlay }: { onPlay: () => void }) {
  const stats = useChainStats();
  const pid = getProgramId().toBase58();

  return (
    <div className="landing">
      <nav className="land-nav">
        <div className="brand">
          <span className="brand-main">CRYPTO</span>
          <span className="brand-accent">SCRABBLE</span>
        </div>
        <button className="btn-gold" onClick={onPlay}>
          Play now
        </button>
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="dot" /> live on solana · every point pays
          </span>
          <h1>
            Burn letters.
            <br />
            <em>Bank SOL.</em>
          </h1>
          <p className="lede">
            The classic word game with real skin in the game. Buy scarce letter
            tokens, form words on-chain, burn what you place — and get paid per
            point, instantly, straight from the vault.
          </p>
          <div className="hero-cta">
            <button className="btn-gold big" onClick={onPlay}>
              Take a seat →
            </button>
            <a className="ghost-link" href="#live">
              see live payouts
            </a>
          </div>
          {!stats && <p className="fineprint">connecting to the chain…</p>}
        </div>

        <aside className="receipt" aria-label="example payout">
          <div className="receipt-head">WORD RECEIPT</div>
          {RECEIPT.map((r) => (
            <div className="receipt-line" key={r.label}>
              <span>{r.label}</span>
              <small>{r.note}</small>
              <b>{r.pts} pts</b>
            </div>
          ))}
          <div className="receipt-line total">
            <span>15 points</span>
            <b>0.075 SOL</b>
          </div>
          <p className="fineprint">
            real play from the devnet table — O landed twice on a double-letter
            square
          </p>
        </aside>
      </header>

      <section className="stats-strip" id="live">
        <div className="statcard">
          <b>{stats ? stats.wordsPlayed.toLocaleString() : '—'}</b>
          <span>words played</span>
        </div>
        <div className="statcard gold">
          <b>{stats ? `${stats.totalPayoutSol.toFixed(3)} ◎` : '—'}</b>
          <span>SOL paid out</span>
        </div>
        <div className="statcard">
          <b>{stats ? stats.totalBurned.toLocaleString() : '—'}</b>
          <span>letter units burned</span>
        </div>
        <div className="statcard">
          <b>{stats ? `${stats.vaultSol.toFixed(2)} ◎` : '—'}</b>
          <span>vault balance</span>
        </div>
      </section>

      <section className="land-section">
        <h2>How it works</h2>
        <div className="steps">
          {STEPS.map((s) => (
            <article className="step" key={s.n}>
              <span className="step-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="land-section two-col">
        <div>
          <h2>Premium ground</h2>
          <p>
            The classic multipliers are live and they pay. Letter bonuses double
            or triple a single tile; word bonuses multiply everything. Only the
            tiles you place this turn claim the square — hold the center star
            and your first word starts doubled.
          </p>
          <ul className="prem-legend">
            <li data-k="tw"><i>TW</i> triple word ×3</li>
            <li data-k="dw"><i>DW</i> double word ×2</li>
            <li data-k="tl"><i>TL</i> triple letter ×3</li>
            <li data-k="dl"><i>DL</i> double letter ×2</li>
          </ul>
        </div>
        <div>
          <h2>Provably fair</h2>
          <p>
            Every submitted word ships a merkle proof against an on-chain
            SHA-256 root over the full tournament dictionary — the program
            rejects anything that isn't a real word, and anyone can audit the
            burns, payouts and board state on Solana explorers.
          </p>
          <ul className="fair-list">
            <li>Token-2022 burns, verifiable forever</li>
            <li>Dictionary root pinned in program config</li>
            <li>Open-source client, deterministic scoring</li>
          </ul>
        </div>
      </section>

      <section className="land-section faq">
        <h2>Questions</h2>
        <details>
          <summary>Where does the SOL come from?</summary>
          <p>
            Entry fees pool in a program-owned vault; payouts flow back out per
            point. The vault balance above is live — when you win, it pays you
            directly in the same transaction that accepts your word.
          </p>
        </details>
        <details>
          <summary>What happens to my letter tokens?</summary>
          <p>
            Placed tiles are burned — removed from supply permanently. That is
            why letters hold value: playing well literally shrinks the
            circulating supply of the letters you used.
          </p>
        </details>
        <details>
          <summary>What are blanks?</summary>
          <p>
            Blank tokens act as wildcards: they can stand for any letter but
            score zero points themselves. Perfect for dumping a hostile rack
            into a big multiplier.
          </p>
        </details>
        <details>
          <summary>Is this the real launch?</summary>
          <p>
            The table currently runs on Solana devnet while the economy gets
            stress-tested with worthless test SOL. Mainnet deployment follows
            once the vault economics prove out.
          </p>
        </details>
      </section>

      <footer className="land-footer">
        <button className="btn-gold big" onClick={onPlay}>
          Play now — it's live
        </button>
        <p className="fineprint">
          Program <code>{pid.slice(0, 4)}…{pid.slice(-4)}</code>{' '}
          <a href={`https://explorer.solana.com/address/${pid}?cluster=devnet`} target="_blank" rel="noreferrer">
            view on explorer ↗
          </a>{' '}
          · Token-2022 · devnet funds have no value
        </p>
      </footer>
    </div>
  );
}
