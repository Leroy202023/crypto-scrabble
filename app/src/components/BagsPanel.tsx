import { useCallback, useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { sfx } from '../lib/sfx';
import {
  OwnedBag,
  Tier,
  artFor,
  buildBuyTransfer,
  buildOpenTx,
  fetchOwnedBags,
  heroFor,
  loadCollection,
  priceSol,
  type CollectionInfo,
} from '../lib/bagsClient';

const TIER_META: Record<Tier, { label: string; blurb: string; cls: string }> = {
  common: { label: 'Common', blurb: '7 tiles · classic rack draw', cls: 'common' },
  rare: { label: 'Rare', blurb: '10 tiles · guaranteed J/Q/X/Z/K', cls: 'rare' },
  legendary: { label: 'Legendary', blurb: '14 tiles · guaranteed blank ␣', cls: 'legendary' },
};

export default function BagsPanel({ onPlay }: { onPlay: () => void }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [col, setCol] = useState<CollectionInfo | null>(null);
  const [owned, setOwned] = useState<OwnedBag[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refreshOwned = useCallback(async () => {
    if (!wallet.publicKey || !col) return;
    try {
      setOwned(await fetchOwnedBags(connection, wallet.publicKey, col));
    } catch { /* transient rpc */ }
  }, [connection, wallet.publicKey, col]);

  useEffect(() => {
    void loadCollection().then(setCol);
  }, []);
  useEffect(() => {
    void refreshOwned();
    const iv = setInterval(() => void refreshOwned(), 12_000);
    return () => clearInterval(iv);
  }, [refreshOwned]);

  const buy = async (tier: Tier) => {
    if (!col || !wallet.publicKey) return;
    sfx.select();
    setBusy(tier);
    setNote(null);
    try {
      const tx = buildBuyTransfer(wallet.publicKey, tier, col.pricesLamports[tier]);
      const sig = await wallet.sendTransaction(tx, connection);
      setNote(`Payment sent — the pack machine is minting bag to you (~30–60 s). tx ${sig.slice(0, 8)}…`);
      sfx.coin();
    } catch (e) {
      setNote(`Payment failed: ${(e as Error).message?.slice(0, 120)}`);
      sfx.error();
    } finally {
      setBusy(null);
    }
  };

  const open = async (bag: OwnedBag) => {
    if (!wallet.publicKey) return;
    sfx.select();
    setBusy(`open-${bag.index}`);
    try {
      const tx = await buildOpenTx(wallet.publicKey, bag);
      const sig = await wallet.sendTransaction(tx, connection);
      sfx.open();
      setNote(`Bag #${bag.index} cracked open! Your letters arrive in ~30–60 s. burn ${sig.slice(0, 8)}…`);
      setTimeout(() => void refreshOwned(), 4000);
    } catch (e) {
      setNote(`Open failed: ${(e as Error).message?.slice(0, 120)}`);
      sfx.error();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="landing bags">
      <nav className="land-nav">
        <div className="brand">
          <span className="brand-main">SCRABBLE</span>
          <span className="brand-accent">BAGS</span>
        </div>
        <button className="btn-gold" onClick={onPlay}>Back to the table</button>
      </nav>

      <header className="hero bags-hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="dot" /> edition 1 · {col ? `${col.count} packs` : 'loading…'}</span>
          <h1>Tear open <em>fortune.</em></h1>
          <p className="lede">
            Every bag is a 1-of-1 NFT hiding a bundle of playable letter tokens —
            the same tokens you burn for SOL on the table. Buy with SOL, crack it
            open, play what you pull.
          </p>
        </div>
        <div className="tier-cards">
          {col && (['common', 'rare', 'legendary'] as Tier[]).map((t) => (
            <button className={`tiercard ${TIER_META[t].cls}`} key={t} onClick={() => void buy(t)} disabled={!!busy || !wallet.publicKey}>
              <img src={heroFor(t)} alt={`${t} bag`} />
              <div className="tiercard-body">
                <b>{TIER_META[t].label}</b>
                <span>{TIER_META[t].blurb}</span>
                <em>{priceSol(col, t)} ◎</em>
              </div>
              <span className="tierbuy">{busy === t ? 'sending…' : wallet.publicKey ? 'Buy pack' : 'connect wallet'}</span>
            </button>
          ))}
        </div>
      </header>

      {note && <div className="bags-note">{note}</div>}

      {owned.length > 0 && (
        <section className="land-section">
          <h2>Your sealed bags</h2>
          <p className="fineprint">Hit Open to crack a bag — its letter tokens land straight in your rack.</p>
          <div className="baggrid">
            {owned.map((b) => (
              <div className="bagcard" key={b.mint.toBase58()}>
                <img src={artFor(b.index)} alt={`bag ${b.index}`} loading="lazy" />
                <div className="bagcard-row">
                  <span>No. {String(b.index + 1).padStart(4, '0')} · {TIER_META[b.tier].label}</span>
                  <button
                    className="btn-gold small"
                    disabled={busy === `open-${b.index}`}
                    onClick={() => void open(b)}
                  >
                    {busy === `open-${b.index}` ? 'opening…' : 'Open'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="land-section">
        <h2>The gallery</h2>
        <p className="fineprint">Every pack is unique — here are the first of the edition.</p>
        <div className="baggrid">
          {col?.bags.slice(0, 24).map((b) => (
            <div className={`bagcard gal ${b.t}`} key={b.m}>
              <img src={artFor(b.i)} alt={`bag ${b.i}`} loading="lazy" />
              <div className="bagcard-row">
                <span>No. {String(b.i + 1).padStart(4, '0')}</span>
                <em>{TIER_META[b.t].label}</em>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="land-footer">
        <p className="fineprint">
          Provably fair — every pack's contents were committed (SHA-256) before
          any sale. Open reveals the preimage. · payments → pack machine → NFT
          mint → burn → letters. Fully on-chain.
        </p>
      </footer>
    </div>
  );
}
