import { useEffect, useMemo, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Cell, Placement, RunResult, evaluateRun } from '@shared/gameplay';
import { proofForWord } from '../lib/dict';
import { loadEconomy, sol } from '../lib/state';
import { buildSubmitWordTx } from '../lib/submitWord';

type Props = {
  cells: Cell[];
  placements: Record<number, string>;
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
      return { x: i % 15, y: Math.floor(i / 15), letter: placements[i] };
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
      // dictionary proof (client-side pre-check; the chain re-verifies)
      const pf = await proofForWord(preview.word);
      if (!pf) throw new Error(`"${preview.word}" is not in the dictionary`);

      const tx = await buildSubmitWordTx({
        player: wallet.publicKey,
        startX: preview.startX,
        startY: preview.startY,
        direction: preview.direction,
        letters: Uint8Array.from(preview.letters),
        newMask: preview.newMask,
        leafIndex: pf.leafIndex,
        proof: pf.proof,
      });

      const sig = await wallet.sendTransaction(tx, connection);
      setOkMsg(`Played "${preview.word.toUpperCase()}" for ${preview.totalScore} pts → ${sol(preview.totalScore * perPointSol)} • sig ${sig.slice(0, 16)}…`);
      onCleared();
      onSubmitted();
    } catch (e) {
      setErr((e as Error).message ?? String(e));
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
