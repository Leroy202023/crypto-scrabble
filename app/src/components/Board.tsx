import { BOARD_SIZE } from '@shared/program';
import { Cell } from '@shared/gameplay';

// classic Scrabble premium layout: T=TW D=DW t=TL d=DL *=center
const LAYOUT = [
  'T--d---T---d--T',
  '-D---t---t---D-',
  '--D---d-d---D--',
  'd--D---d---D--d',
  '----D-----D----',
  '-t---t---t---t-',
  '--d---d-d---d--',
  'T--d---*---d--T',
  '--d---d-d---d--',
  '-t---t---t---t-',
  '----D-----D----',
  'd--D---d---D--d',
  '--D---d-d---D--',
  '-D---t---t---D-',
  'T--d---T---d--T',
];

type Props = {
  cells: Cell[];
  placements: Record<number, string>;
  selectedIndex: number | null;
  onCellClick: (i: number) => void;
};

export default function Board({ cells, placements, selectedIndex, onCellClick }: Props) {
  return (
    <div className="boardframe">
      <div className="board" role="grid" aria-label="game board">
        {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => {
          const x = i % BOARD_SIZE;
          const y = Math.floor(i / BOARD_SIZE);
          const prem = LAYOUT[y][x];
          const pending = placements[i];
          const onChain = cells[i];
          const letter = pending ?? (onChain?.occupied ? onChain.letter : undefined);
          const isNew = !!pending;
          const cls = ['cell'];
          if (prem === 'T') cls.push('tw');
          if (prem === 'D') cls.push('dw');
          if (prem === 't') cls.push('tl');
          if (prem === 'd') cls.push('dl');
          if (prem === '*') { cls.push('star'); if (letter) cls.push('filled'); }
          if (isNew) cls.push('new');
          if (selectedIndex === i) cls.push('sel');
          return (
            <div key={i} className={cls.join(' ')} onClick={() => onCellClick(i)} title={`${String.fromCharCode(65 + x)}${y + 1}`}>
              {letter && (
                <span className="lt">
                  {letter.toUpperCase()}
                  {isNew && <span className="sub">NEW</span>}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
