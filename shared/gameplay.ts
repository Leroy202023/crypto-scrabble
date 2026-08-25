// Client-side placement engine. Mirrors the on-chain structural rules in
// submit_word.rs and adds full Scrabble-style cross-word detection so players
// get accurate scoring previews before they sign.
import { BOARD_SIZE, TOTAL_CELLS, scoreWord } from './program';

export type Cell = { occupied: boolean; letter?: string; player?: string };
export type Board = Cell[]; // length 225, row-major (y * 15 + x)
export type Placement = { x: number; y: number; letter: string };

export const idx = (x: number, y: number) => y * BOARD_SIZE + x;

export function emptyBoard(): Board {
  return Array.from({ length: TOTAL_CELLS }, () => ({ occupied: false }));
}

export function boardFromOnChain(cells: { occupied: boolean; letter: number; player: string }[]): Board {
  return cells.map((c) => ({
    occupied: c.occupied,
    letter: c.letter ? String.fromCharCode(97 + c.letter - 1).toLowerCase() : undefined,
    player: c.player,
  }));
}

export type RunResult = {
  ok: boolean;
  reason?: string;
  /** full main word formed */
  word: string;
  letters: number[]; // ascii a..z of run
  newMask: boolean[];
  startX: number;
  startY: number;
  direction: 0 | 1;
  leafIndexHint?: never;
  /** all words formed this turn (main + crosses), with scores */
  formedWords: string[];
  totalScore: number;
};

const at = (board: Board, x: number, y: number): Cell | null =>
  x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE ? null : board[idx(x, y)];

/**
 * Evaluate a candidate move. `placements` must be contiguous along one axis
 * but MAY skip cells occupied by existing tiles (standard Scrabble).
 */
export function evaluateRun(
  board: Board,
  placements: Placement[],
  direction: 0 | 1,
  isFirstMove: boolean,
): RunResult {
  if (placements.length === 0) return fail('place at least one tile');
  const dx = direction === 0 ? 1 : 0;
  const dy = direction === 1 ? 1 : 0;

  // normalize order along the run axis
  placements = [...placements].sort((a, b) => (a.x - b.x) * dx + (a.y - b.y) * dy);

  // cannot overwrite
  for (const p of placements) {
    if (at(board, p.x, p.y)?.occupied) return fail('cannot overwrite an occupied cell');
  }

  const placedSet = new Set(placements.map((p) => `${p.x},${p.y}`));

  // expand run bounds through adjacent existing tiles
  const first = placements[0];
  let minX = first.x;
  let minY = first.y;
  const lastP = placements[placements.length - 1];
  let endX = lastP.x;
  let endY = lastP.y;
  while (at(board, minX - dx, minY - dy)?.occupied) {
    minX -= dx;
    minY -= dy;
  }
  while (at(board, endX + dx, endY + dy)?.occupied) {
    endX += dx;
    endY += dy;
  }

  // every cell in the span must be a new placement or an existing tile
  for (let x = minX, y = minY; ; x += dx, y += dy) {
    const key = `${x},${y}`;
    if (!placedSet.has(key) && !at(board, x, y)?.occupied) {
      return fail('tiles must form one contiguous line (existing tiles may bridge gaps)');
    }
    if (x === endX && y === endY) break;
  }
  const letters: number[] = [];
  const newMask: boolean[] = [];
  const wordChars: string[] = [];
  let len = 0;
  for (let x = minX, y = minY; ; x += dx, y += dy) {
    len++;
    const key = `${x},${y}`;
    if (placedSet.has(key)) {
      const ch = placements.find((p) => p.x === x && p.y === y)!.letter.toLowerCase();
      letters.push(ch.charCodeAt(0));
      newMask.push(true);
      wordChars.push(ch);
    } else {
      const cell = at(board, x, y)!;
      if (!cell.occupied || !cell.letter) return fail('internal: missing bridged tile');
      const ch = cell.letter.toLowerCase();
      letters.push(ch.charCodeAt(0));
      newMask.push(false);
      wordChars.push(ch);
    }
    if (x === endX && y === endY) break;
  }
  const word = wordChars.join('');

  if (len > BOARD_SIZE) return fail('word runs off the board');
  if (len < 2) return fail('words need at least 2 letters');

  if (isFirstMove) {
    const coversCenter = placements.some(
      (_, i) => idx(minX + dx * i, minY + dy * i) === idx(7, 7),
    );
    if (!coversCenter) return fail('the first word must cover the center star');
  } else {
    const touchesExisting =
      newMask.includes(false) ||
      placements.some((p) =>
        [
          at(board, p.x + 1, p.y),
          at(board, p.x - 1, p.y),
          at(board, p.x, p.y + 1),
          at(board, p.x, p.y - 1),
        ].some((c) => c?.occupied),
      );
    if (!touchesExisting) return fail('new tiles must connect to the board');
  }

  // collect every word formed this turn (main + perpendicular crosses)
  const formedWords: string[] = [word];
  for (const p of placements) {
    const cdx = direction === 0 ? 0 : 1;
    const cdy = direction === 0 ? 1 : 0;
    let bx = p.x;
    let by = p.y;
    while (at(board, bx - cdx, by - cdy)?.occupied) {
      bx -= cdx;
      by -= cdy;
    }
    let ex = p.x;
    let ey = p.y;
    while (at(board, ex + cdx, ey + cdy)?.occupied) {
      ex += cdx;
      ey += cdy;
    }
    const crossLen = (ex - bx) * cdx + (ey - by) * cdy + 1;
    if (crossLen >= 2) {
      const chars: string[] = [];
      for (let i = 0; i < crossLen; i++) {
        const cx = bx + cdx * i;
        const cy = by + cdy * i;
        const placed = placedSet.has(`${cx},${cy}`);
        const cell = placed ? undefined : at(board, cx, cy);
        chars.push(
          placed
            ? placements.find((q) => q.x === cx && q.y === cy)!.letter.toLowerCase()
            : cell!.letter!.toLowerCase(),
        );
      }
      formedWords.push(chars.join(''));
    }
  }

  // v1 on-chain payout scores the MAIN word only; preview matches that.
  const totalScore = scoreWord(word);
  return { ok: true, word, letters, newMask, startX: minX, startY: minY, direction, formedWords, totalScore };

  function fail(reason: string): RunResult {
    return {
      ok: false,
      reason,
      word: '',
      letters: [],
      newMask: [],
      startX: 0,
      startY: 0,
      direction,
      formedWords: [],
      totalScore: 0,
    };
  }
}
