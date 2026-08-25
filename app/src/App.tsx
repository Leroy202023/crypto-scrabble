import { useCallback, useEffect, useState } from 'react';
import { ConnectionProvider, WalletProvider, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import Board from './components/Board';
import Rack from './components/Rack';
import SubmitPanel from './components/SubmitPanel';
import MarketPanel from './components/MarketPanel';
import GameStats from './components/GameStats';
import { useRack } from './lib/rack';
import { BOARD, RPC_URL, loadEconomy, shortAddr } from './lib/state';
import type { Cell } from '@shared/gameplay';

const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

function TopBar() {
  const wallet = useWallet();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-main">CRYPTO</span>
        <span className="brand-accent">SCRABBLE</span>
        <span className="brand-tag">burn letters · bank SOL</span>
      </div>
      <div className="walletbox">
        {!wallet.connected ? (
          <>
            {wallet.wallets.map((w) => (
              <button key={w.adapter.name} className="btn-gold" onClick={() => void wallet.select(w.adapter.name)}>
                Connect&nbsp;<b>{w.adapter.name}</b>
              </button>
            ))}
          </>
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
    </header>
  );
}

function Table() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [cells, setCells] = useState<Cell[]>(() => Array.from({ length: 225 }, () => ({ occupied: false })));
  const [placements, setPlacements] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [burnQty, setBurnQty] = useState(1000);
  const [tick, setTick] = useState(0);
  const balances = useRack(wallet.publicKey ?? null, tick);

  useEffect(() => {
    loadEconomy().then((e) => setBurnQty(e.burnQty));
  }, []);

  /** Decode GameBoard account: disc(8) + words_played(8) + 225×[u8,u8,32B]. */
  const refreshBoard = useCallback(async () => {
    try {
      const info = await connection.getAccountInfo(BOARD);
      if (!info || info.data.length < 16 + 34) return;
      const next: Cell[] = Array.from({ length: 225 }, (_, i) => {
        const off = 16 + i * 34;
        const byte = info.data[off + 1];
        return {
          occupied: info.data[off] === 1,
          letter: byte >= 97 && byte <= 122 ? String.fromCharCode(byte) : undefined,
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
      setPlacements((p) => ({ ...p, [i]: selected }));
    },
    [cells, placements, selected],
  );

  return (
    <div className="layout">
      <section className="table-side">
        <div className="panel boardpanel">
          <h3>The Shared Board</h3>
          <Board cells={cells} placements={placements} selectedIndex={null} onCellClick={onCellClick} />
        </div>
        <Rack balances={balances} burnQty={burnQty} selected={selected} onSelect={(l) => setSelected((s) => (s === l ? null : l))} />
      </section>

      <aside className="side">
        <SubmitPanel
          cells={cells}
          placements={placements}
          onCleared={() => setPlacements({})}
          onSubmitted={bump}
        />
        <GameStats />
        <MarketPanel balances={balances} burnQty={burnQty} />
        <div className="panel">
          <h3>House Rules</h3>
          <div className="fineprint">
            Place tiles → the program burns <b>{burnQty.toLocaleString()}</b> of each placed letter token straight
            out of your wallet, collects the entry fee, verifies your word against an on-chain dictionary merkle
            root, and pays you SOL from the vault proportional to Scrabble points. Rare letters cost more because
            supply is scarce — and every play burns it forever.
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function App() {
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <div className="app">
          <TopBar />
          <Table />
          <footer className="footer">
            <span>Program <code>53h7…FkrUT</code> · Token-2022 · dictionary verified on-chain via SHA-256 merkle proofs</span>
          </footer>
        </div>
      </WalletProvider>
    </ConnectionProvider>
  );
}
