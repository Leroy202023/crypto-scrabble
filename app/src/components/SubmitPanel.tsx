import { useEffect, useMemo, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Cell, Placement, RunResult, evaluateRun } from '@shared/gameplay';
import { proofForWord } from '../lib/dict';
import { loadEconomy, sol } from '../lib/state';
import { buildSubmitWordTx } from '../lib/submitWord';
import { friendlyError } from '../lib/friendlyError';
import type { PendingTile } from './Board';

type Props = {
  cells: Cell[];
  placements: Record<number, PendingTile>;
  onSubmitted: () => void;
  onCleared: () => void;
};

export default function SubmitPanel({ cells, placements, onSubmitted, onCleared }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [perPointSol, setPerPointSol] = useState(0.005);
  const [burnQty, setBurnQty] = useState(1000);

  useEffect(() => {
    loadEconomy().then((e) => {
      setPerPointSol(e.perPointSol);
      setBurnQty(e.burnQty);
    });
  }, []);

  const preview: RunResult | null = useMemo(() => {
    const keys = Object.keys(placements);
    if (keys.length === 0 || !wallet.publicKey) return null;
    const placementsArr: Placement[] = keys.map((k) => {
      const i = Number(k);
      return { x: i % 15, y: Math.floor(i / 15), letter: placements[i].letter };
    });
    const sameRow = placementsArr.every((p) => p.y === placementsArr[0].y);
    const sameCol = placementsArr.every((p) => p.x === placementsArr[0].x);
    const isFirstMove = !cells.some((c) => c.occupied);
    if (sameRow && sameCol) {
      // single tile — try both axes
      return (
        evaluateRun(cells, placementsArr, 0, isFirstMove).ok
          ? evaluateRun(cells, placementsArr, 0, isFirstMove)
          : evaluateRun(cells, placementsArr, 1, isFirstMove)
      );
    }
    const dir: 0 | 1 = sameRow ? 0 : 1;
    return evaluateRun(cells, placementsArr, dir, isFirstMove);
  }, [placements, cells]);

  async function submit() {
    setErr('');
    setOkMsg('');
    if (!wallet.publicKey || !preview?.ok || !preview.newMask.some(Boolean)) return;
    setBusy(true);
    try {
      // dictionary proofs for the main word + every perpendicular cross-word
      // (client-side pre-check; the chain re-verifies each one).
      const proofs = await Promise.all(
        preview.formedWords.map((w) => proofForWord(w)),
      );
      if (proofs.some((p) => !p)) {
        const bad = preview.formedWords[proofs.findIndex((p) => !p)];
        throw new Error(`"${bad.toUpperCase()}" is not in the dictionary`);
      }
      const main = proofs[0]!;
      const crossWords = proofs.slice(1).map((p) => ({ leafIndex: p!.leafIndex, proof: p!.proof }));

      const tx = await buildSubmitWordTx({
        player: wallet.publicKey,
        startX: preview.startX,
        startY: preview.startY,
        direction: preview.direction,
        letters: Uint8Array.from(preview.letters),
        newMask: preview.newMask,
        blankMask: preview.blankMask,
        leafIndex: main.leafIndex,
        proof: main.proof,
        crossWords,
      });

      const sig = await wallet.sendTransaction(tx, connection);
      setOkMsg(`Played "${preview.word.toUpperCase()}" for ${preview.totalScore} pts → ${sol(preview.totalScore * perPointSol)} • sig ${sig.slice(0, 16)}…`);
      onCleared();
      onSubmitted();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>Play Your Word</h3>
      {!preview ? (
        <span className="fineprint">Select a rack tile, then click empty board squares.</span>
      ) : preview.ok ? (
        <>
           <div className="statline"><span>Main word</span><b>{preview.word.toUpperCase()}</b></div>
           {preview.blankMask.some(Boolean) && (
             <div className="statline"><span>Uses blank</span><b>{preview.blankMask.filter(Boolean).length} (0 pts each)</b></div>
           )}
           <div className="statline"><span>Score</span><b>{preview.totalScore} pts</b></div>
          <div className="statline"><span>Est. payout</span><b>{sol(preview.totalScore * perPointSol)}</b></div>
          <div className="statline">
            <span>Burns</span>
            <b>
              {preview.newMask.filter(Boolean).length} tiles × {burnQty.toLocaleString()} tokens
            </b>
          </div>
          <div className="statline"><span>All words formed</span><b>{preview.formedWords.map((w) => w.toUpperCase()).join(', ')}</b></div>
        </>
      ) : (
        <div className="err">{preview.reason}</div>
      )}
      <button
        className="primary"
        disabled={!preview?.ok || busy || !wallet.connected}
        onClick={submit}
      >
        {busy ? 'Sending…' : 'Burn & Submit'}
      </button>
      {!wallet.connected && <div className="err">Connect a wallet first.</div>}
      <div className="err">{err}</div>
      <div className="okmsg">{okMsg}</div>
    </div>
  );
}
