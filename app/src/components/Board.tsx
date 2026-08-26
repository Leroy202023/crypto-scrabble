import type { CSSProperties } from 'react';
import { BOARD_SIZE } from '@shared/program';
import { Cell, PREMIUM_ROWS as LAYOUT } from '@shared/gameplay';

const PREM_LABEL: Record<string, string> = { T: 'TW', D: 'DW', t: 'TL', d: 'DL' };

/** Stable per-player hue for PvP tinting. */
export function playerHue(player?: string): number {
  if (!player) return 0;
  let h = 0;
  for (let i = 0; i < player.length; i++) h = (h * 31 + player.charCodeAt(i)) >>> 0;
  return h % 360;
}

export type PendingTile = { letter: string; blank?: boolean };

type Props = {
  cells: Cell[];
  placements: Record<number, PendingTile>;
  selectedIndex: number | null;
  onCellClick: (i: number) => void;
  /** connected wallet — used to mark your tiles */
  me?: { toBase58(): string } | null;
};

export default function Board({ cells, placements, selectedIndex, onCellClick, me }: Props) {
  const mine = me?.toBase58();
  return (
    <div className="boardframe">
      <div className="board" role="grid" aria-label="game board">
        {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => {
          const x = i % BOARD_SIZE;
          const y = Math.floor(i / BOARD_SIZE);
          const prem = LAYOUT[y][x];
          const pending = placements[i];
          const onChain = cells[i];
          const letter = pending?.letter ?? (onChain?.occupied ? onChain.letter : undefined);
          const isNew = !!pending;
          const blank = pending?.blank || onChain?.blank;
          const cls = ['cell'];
          if (prem === '*') { cls.push('star'); if (letter) cls.push('filled'); }
          else if (PREM_LABEL[prem]) cls.push(prem === 'T' ? 'tw' : prem === 'D' ? 'dw' : prem === 't' ? 'tl' : 'dl');
          if (isNew) cls.push('new');
          if (blank) cls.push('blankcell');
          if (selectedIndex === i) cls.push('sel');
          const owner = onChain?.player;
          const hue = playerHue(owner);
          const style = owner ? ({ ['--ph']: String(hue) } as CSSProperties) : undefined;
          return (
            <div
              key={i}
              className={cls.join(' ')}
              style={style}
              onClick={() => onCellClick(i)}
              title={`${String.fromCharCode(65 + x)}${y + 1}${owner ? ` · played by ${owner.slice(0, 4)}…${owner.slice(-4)}` : ''}`}
            >
              {!letter && PREM_LABEL[prem] && <span className="prem">{PREM_LABEL[prem]}</span>}
              {letter && (
                <span className={`lt${owner ? (owner === mine ? ' mine' : ' theirs') : ''}`}>
                  {pending?.blank && !onChain?.occupied ? '?' : letter.toUpperCase()}
                  {isNew && <span className="sub">{pending?.blank ? 'BLANK' : 'NEW'}</span>}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
