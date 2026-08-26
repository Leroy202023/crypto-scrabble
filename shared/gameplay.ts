// Client-side placement engine. Mirrors the on-chain structural rules in
// submit_word.rs and adds full Scrabble-style cross-word detection so players
// get accurate scoring previews before they sign.
import { BOARD_SIZE, TOTAL_CELLS, LETTER_VALUES, scoreWordWithBlanks } from './program';

/**
 * Premium (DL/TL/DW/TW) scoring. The client and the deployed program must
 * ALWAYS agree, so this only turns on once the premium-enabled program is
 * actually live on the target cluster (`solana program deploy` + rebuild).
 * Until then estimates fall back to the plain blank-aware score the deployed
 * program pays.
 */
export const PREMIUM_ENABLED = true;

export type Cell = { occupied: boolean; letter?: string; player?: string; blank?: boolean };
export type Board = Cell[]; // length 225, row-major (y * 15 + x)
export type Placement = { x: number; y: number; letter: string; blank?: boolean };

export const idx = (x: number, y: number) => y * BOARD_SIZE + x;

export function emptyBoard(): Board {
  return Array.from({ length: TOTAL_CELLS }, () => ({ occupied: false }));
}

export function boardFromOnChain(cells: { occupied: boolean; letter: number; player: string }[]): Board {
  return cells.map((c) => ({
    occupied: c.occupied,
    letter: c.letter ? String.fromCharCode(c.letter).toLowerCase() : undefined,
    player: c.player,
  }));
}

/** Premium multiplier for an enum value (None, DL, TL, DW, TW). */
export function premiumMultiplier(p: number): { letter: number; word: number } {
  switch (p) {
    case 1: return { letter: 2, word: 1 }; // DL
    case 2: return { letter: 3, word: 1 }; // TL
    case 3: return { letter: 1, word: 2 }; // DW
    case 4: return { letter: 1, word: 3 }; // TW
    default: return { letter: 1, word: 1 };
  }
}

// Classic Scrabble premium layout — single source of truth for board display
// and scoring. T=triple word, D=double word, t=triple letter, d=double letter,
// *=center (double word), -=plain. Mirrors the on-chain PREMIUM_CHARS.
export const PREMIUM_ROWS = [
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
const CHAR_TO_PREM: Record<string, number> = { T: 4, D: 3, t: 2, d: 1, '*': 3 };

/** (letterMultiplier, wordMultiplier) for a board cell. */
export function premiumAt(x: number, y: number): { letter: number; word: number } {
  const c = PREMIUM_ROWS[y][x];
  return premiumMultiplier(CHAR_TO_PREM[c] ?? 0);
}

/**
 * Premium-aware word score. Letter multipliers apply only to new, non-blank
 * tiles on a (double/triple) letter square; word multipliers apply once per
 * word for every new, non-blank tile on a (double/triple) word square. Blanks
 * score 0. `positions` are board indices (y * BOARD_SIZE + x), parallel to the
 * other arrays. Mirrors `score_word_with_bonuses` in submit_word.rs.
 */
export function scoreWordWithBonuses(
  positions: number[],
  word: string,
  isNew: boolean[],
  isBlank: boolean[],
): number {
  let wordMult = 1;
  let letterSum = 0;
  for (let i = 0; i < word.length; i++) {
    if (isBlank[i]) continue; // blanks score 0
    const base = LETTER_VALUES[word.charCodeAt(i) - 97];
    let pts = base;
    if (isNew[i]) {
      const x = positions[i] % BOARD_SIZE;
      const y = Math.floor(positions[i] / BOARD_SIZE);
      const prem = premiumAt(x, y);
      pts *= prem.letter;
      wordMult *= prem.word;
    }
    letterSum += pts;
  }
  return letterSum * wordMult;
}

function runPositions(sx: number, sy: number, dx: number, dy: number, len: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    out.push((sy + dy * i) * BOARD_SIZE + (sx + dx * i));
  }
  return out;
}

export type RunResult = {
  ok: boolean;
  reason?: string;
  /** full main word formed */
  word: string;
  letters: number[]; // ascii a..z of run
  newMask: boolean[];
  /** true where the corresponding run position is a blank (scores 0). */
  blankMask: boolean[];
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
  const blankMask: boolean[] = [];
  const wordChars: string[] = [];
  let len = 0;
  for (let x = minX, y = minY; ; x += dx, y += dy) {
    len++;
    const key = `${x},${y}`;
    if (placedSet.has(key)) {
      const pl = placements.find((p) => p.x === x && p.y === y)!;
      const ch = pl.letter.toLowerCase();
      letters.push(ch.charCodeAt(0));
      newMask.push(true);
      blankMask.push(!!pl.blank);
      wordChars.push(ch);
    } else {
      const cell = at(board, x, y)!;
      if (!cell.occupied || !cell.letter) return fail('internal: missing bridged tile');
      const ch = cell.letter.toLowerCase();
      letters.push(ch.charCodeAt(0));
      newMask.push(false);
      blankMask.push(!!cell.blank);
      wordChars.push(ch);
    }
    if (x === endX && y === endY) break;
  }
  const word = wordChars.join('');

  if (len > BOARD_SIZE) return fail('word runs off the board');
  if (len < 2) return fail('words need at least 2 letters');

  if (isFirstMove) {
    // Scan the full run span (placements + any bridged existing tiles) for the
    // center star; using placement indices alone misses a center that lands on
    // a bridged cell.
    let coversCenter = false;
    for (let x = minX, y = minY; ; x += dx, y += dy) {
      if (x === 7 && y === 7) {
        coversCenter = true;
        break;
      }
      if (x === endX && y === endY) break;
    }
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

  // collect every word formed this turn (main + perpendicular crosses), with
  // parallel blank flags so blank tiles score 0 (standard Scrabble).
  const formedWords: string[] = [word];
  const formedBlanks: boolean[][] = [blankMask];
  const formedPositions: number[][] = [runPositions(minX, minY, dx, dy, len)];
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
      const blanks: boolean[] = [];
      const positions: number[] = [];
      for (let i = 0; i < crossLen; i++) {
        const cx = bx + cdx * i;
        const cy = by + cdy * i;
        positions.push(cy * BOARD_SIZE + cx);
        const placed = placedSet.has(`${cx},${cy}`);
        if (placed) {
          const pl = placements.find((q) => q.x === cx && q.y === cy)!;
          chars.push(pl.letter.toLowerCase());
          blanks.push(!!pl.blank);
        } else {
          const cell = at(board, cx, cy)!;
          chars.push(cell.letter!.toLowerCase());
          blanks.push(!!cell.blank);
        }
      }
      formedWords.push(chars.join(''));
      formedBlanks.push(blanks);
      formedPositions.push(positions);
    }
  }

  // Total score = main word + every perpendicular cross-word, with premium
  // squares applied to newly placed tiles (matching the on-chain payout).
  // Blanks score 0. Order of formedWords is [main, ...crosses]; crosses follow
  // the new tiles in run order so the client and program produce identical
  // proof sets.
  const isNewFor = (positions: number[]) =>
    positions.map((pos) => placedSet.has(`${pos % BOARD_SIZE},${Math.floor(pos / BOARD_SIZE)}`));

  let totalScore = 0;
  for (let i = 0; i < formedWords.length; i++) {
    if (!PREMIUM_ENABLED) {
      totalScore += scoreWordWithBlanks(formedWords[i], formedBlanks[i]);
      continue;
    }
    const positions = formedPositions[i];
    const isNew = i === 0 ? newMask : isNewFor(positions);
    totalScore += scoreWordWithBonuses(positions, formedWords[i], isNew, formedBlanks[i]);
  }
  return { ok: true, word, letters, newMask, blankMask, startX: minX, startY: minY, direction, formedWords, totalScore };

  function fail(reason: string): RunResult {
    return {
      ok: false,
      reason,
      word: '',
      letters: [],
      newMask: [],
      blankMask: [],
      startX: 0,
      startY: 0,
      direction,
      formedWords: [],
      totalScore: 0,
    };
  }
}
