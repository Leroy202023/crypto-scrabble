import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionProvider, WalletProvider, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import Board, { PendingTile } from './components/Board';
import Rack from './components/Rack';
import SubmitPanel from './components/SubmitPanel';
import MarketPanel from './components/MarketPanel';
import GameStats from './components/GameStats';
import Landing from './components/Landing';
import { useRack } from './lib/rack';
import { BOARD, getProgramId, getRpcUrl, loadEconomy, shortAddr } from './lib/state';
import { getClusterKey, setClusterKey, CLUSTERS, CLUSTER_ORDER, type ClusterKey } from './lib/clusters';
import { loadPrices, type PriceInfo } from './lib/prices';
import type { Cell } from '@shared/gameplay';

const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

function TopBar() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
  const [netMsg, setNetMsg] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const netRef = useRef<HTMLDivElement>(null);
  const clusterKey = getClusterKey();
  const cluster = CLUSTERS[clusterKey];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!netOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (netRef.current && !netRef.current.contains(e.target as Node)) setNetOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [netOpen]);

  useEffect(() => {
    if (!netMsg) return;
    const t = setTimeout(() => setNetMsg(null), 5000);
    return () => clearTimeout(t);
  }, [netMsg]);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-main">CRYPTO</span>
        <span className="brand-accent">SCRABBLE</span>
        <span className="brand-tag">burn letters · bank SOL</span>
      </div>
      <div className="walletbox">
        <div className="netmenu-wrap" ref={netRef}>
          <button
            className={`netbtn${cluster.deployed ? '' : ' netbtn-warn'}`}
            onClick={() => setNetOpen((o) => !o)}
            title={cluster.deployed ? `Network: ${cluster.label}` : `Network: ${cluster.label} (program not deployed)`}
          >
            <span className="netdot" data-net={clusterKey} />
            {cluster.label}
            {!cluster.deployed && <span className="netwarn">· undeployed</span>}
          </button>
          {netOpen && (
            <div className="netmenu">
              {CLUSTER_ORDER.map((k: ClusterKey) => (
                <button
                  key={k}
                  className={`netmenu-item${k === clusterKey ? ' active' : ''}`}
                  onClick={() => {
                    setNetOpen(false);
                    if (k === clusterKey) return;
                    if (!CLUSTERS[k].deployed) {
                      setNetMsg(`${CLUSTERS[k].label} isn't deployed yet — switch once the program is live there.`);
                      return;
                    }
                    setNetMsg(null);
                    setClusterKey(k);
                  }}
                >
                  <span className="netdot" data-net={k} />
                  {CLUSTERS[k].label}
                  {!CLUSTERS[k].deployed && <span className="netwarn">· undeployed</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {!wallet.connected ? (
          <div className="walletmenu-wrap" ref={menuRef}>
            <button className="btn-gold" onClick={() => setOpen((o) => !o)}>
              Connect Wallet
            </button>
            {open && (
              <div className="walletmenu">
                {wallet.wallets.map((w) => (
                  <button
                    key={w.adapter.name}
                    className="walletmenu-item"
                    onClick={() => {
                      setOpen(false);
                      void wallet.select(w.adapter.name);
                    }}
                  >
                    {w.adapter.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className="connected">
            <span className="dot" />
            <span className="addr">{wallet.publicKey ? shortAddr(wallet.publicKey.toBase58()) : ''}</span>
            <button className="ghost" onClick={() => void wallet.disconnect()}>
              Disconnect
            </button>
          </span>
        )}
      </div>
      {netMsg && <div className="netmsg">{netMsg}</div>}
    </header>
  );
}

function Table() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [cells, setCells] = useState<Cell[]>(() => Array.from({ length: 225 }, () => ({ occupied: false })));
  const [placements, setPlacements] = useState<Record<number, PendingTile>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [blankAt, setBlankAt] = useState<number | null>(null); // pending blank cell
  const [burnQty, setBurnQty] = useState(1000);
  const [tick, setTick] = useState(0);
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({});
  const balances = useRack(wallet.publicKey ?? null, tick);

  useEffect(() => {
    loadEconomy().then((e) => setBurnQty(e.burnQty));
  }, []);

  useEffect(() => {
    let alive = true;
    loadPrices().then((p) => alive && setPrices(p));
    return () => {
      alive = false;
    };
  }, []);

  /** Decode GameBoard: disc(8) + words_played(8) + 225×[u8,u8,blank,32B]. */
  const refreshBoard = useCallback(async () => {
    try {
      const info = await connection.getAccountInfo(BOARD());
      if (!info || info.data.length < 16 + 35) return;
      const next: Cell[] = Array.from({ length: 225 }, (_, i) => {
        const off = 16 + i * 35;
        const byte = info.data[off + 1];
        return {
          occupied: info.data[off] === 1,
          letter: byte >= 97 && byte <= 122 ? String.fromCharCode(byte) : undefined,
          blank: info.data[off + 2] === 1,
          player: info.data[off] === 1 ? new PublicKey(info.data.subarray(off + 3, off + 35)).toBase58() : undefined,
        };
      });
      setCells(next);
    } catch (e) {
      console.warn('board fetch', e);
    }
  }, [connection]);

  useEffect(() => {
    void refreshBoard();
  }, [refreshBoard]);

  const bump = useCallback(() => {
    void refreshBoard();
    setTimeout(() => setTick((t) => t + 1), 3500);
  }, [refreshBoard]);

  const onCellClick = useCallback(
    (i: number) => {
      if (cells[i]?.occupied) return;
      if (placements[i]) {
        setPlacements((p) => {
          const n = { ...p };
          delete n[i];
          return n;
        });
        return;
      }
      if (!selected) return;
      // blank tile needs a letter chosen via the picker
      if (selected === '*') {
        setBlankAt(i);
        return;
      }
      setPlacements((p) => ({ ...p, [i]: { letter: selected } }));
    },
    [cells, placements, selected],
  );

  const chooseBlank = useCallback(
    (letter: string) => {
      if (blankAt == null) return;
      const i = blankAt;
      setBlankAt(null);
      setPlacements((p) => ({ ...p, [i]: { letter, blank: true } }));
    },
    [blankAt],
  );

  return (
    <div className="layout">
      <section className="table-side">
        <div className="panel boardpanel">
          <h3>The Shared Board</h3>
          <Board cells={cells} placements={placements} selectedIndex={null} onCellClick={onCellClick} me={wallet.publicKey ?? undefined} />
        </div>
        <div className="actionbar">
          <Rack balances={balances} burnQty={burnQty} prices={prices} selected={selected} onSelect={(l) => setSelected((s) => (s === l ? null : l))} address={wallet.publicKey?.toBase58()} />
          <SubmitPanel
            cells={cells}
            placements={placements}
            onCleared={() => setPlacements({})}
            onSubmitted={bump}
          />
        </div>
      </section>

      <aside className="side">
        <GameStats />
        <MarketPanel balances={balances} burnQty={burnQty} prices={prices} />
        <div className="panel">
          <h3>House Rules</h3>
          <div className="fineprint">
            Place tiles → the program burns <b>{burnQty.toLocaleString()}</b> of each placed letter token straight
            out of your wallet, collects the entry fee, verifies your word against an on-chain dictionary merkle
            root, and pays you SOL from the vault proportional to Scrabble points. Rare letters cost more because
            supply is scarce — and every play burns it forever. A <b>blank</b> (␣) plays any letter you choose and
            scores 0 points.
          </div>
        </div>
      </aside>

      {blankAt != null && (
        <div className="blankpicker-backdrop" onClick={() => setBlankAt(null)}>
          <div className="blankpicker" onClick={(e) => e.stopPropagation()}>
            <h4>Choose a letter for the blank</h4>
            <div className="blankgrid">
              {'abcdefghijklmnopqrstuvwxyz'.split('').map((l) => (
                <button key={l} onClick={() => chooseBlank(l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const clusterKey = getClusterKey();
  const cluster = CLUSTERS[clusterKey];
  const [route, setRoute] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (p: string) => {
    window.history.pushState({}, '', p);
    setRoute(p);
    window.scrollTo(0, 0);
  };
  const isPlay = route.startsWith('/play');

  return (
    <ConnectionProvider endpoint={getRpcUrl()} key={clusterKey}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        {!isPlay ? (
          <Landing onPlay={() => go('/play')} />
        ) : (
        <div className="app">
          <TopBar />
          <Table />
          <footer className="footer">
            <span>
              Program <code>{shortAddr(getProgramId().toBase58())}</code> · {cluster.label} · Token-2022 · dictionary
              verified on-chain via SHA-256 merkle proofs
            </span>
          </footer>
        </div>
        )}
      </WalletProvider>
    </ConnectionProvider>
  );
}
