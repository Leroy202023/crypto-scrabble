import { describe, expect, it } from 'vitest';
import { Board, Placement, evaluateRun, idx } from '../../shared/gameplay';

function empty(): Board {
  return Array.from({ length: 225 }, () => ({ occupied: false }));
}

function place(board: Board, placements: Placement[]) {
  for (const p of placements)
    board[idx(p.x, p.y)] = { occupied: true, letter: p.letter.toLowerCase(), player: 'tester' };
}

describe('gameplay rules', () => {
  it('first word must cover the center', () => {
    const ok = evaluateRun(
      empty(),
      [
        { x: 7, y: 7, letter: 'c' },
        { x: 8, y: 7, letter: 'a' },
        { x: 9, y: 7, letter: 't' },
      ],
      0,
      true,
    );
    expect(ok.ok).toBe(true);
    expect(ok.word).toBe('cat');

    const offCenter = evaluateRun(
      empty(),
      [
        { x: 2, y: 2, letter: 'c' },
        { x: 3, y: 2, letter: 'a' },
      ],
      0,
      true,
    );
    expect(offCenter.ok).toBe(false);
  });

  it('later words must connect to existing tiles', () => {
    const b = empty();
    place(b, [
      { x: 7, y: 7, letter: 'c' },
      { x: 8, y: 7, letter: 'a' },
      { x: 9, y: 7, letter: 't' },
    ]);

    // S under T -> vertical run "ts" touching the board
    const touching = evaluateRun(b, [{ x: 9, y: 8, letter: 's' }], 1, false);
    expect(touching.ok).toBe(true);
    expect(touching.word).toBe('ts');

    // two tiles in a far corner touch nothing
    const floating = evaluateRun(
      b,
      [
        { x: 0, y: 0, letter: 'q' },
        { x: 1, y: 0, letter: 'z' },
      ],
      0,
      false,
    );
    expect(floating.ok).toBe(false);
  });

  it('bridges existing tiles into one contiguous run', () => {
    const b = empty();
    place(b, [
      { x: 5, y: 7, letter: 'c' },
      { x: 6, y: 7, letter: 'a' },
    ]);
    const r = evaluateRun(
      b,
      [
        { x: 4, y: 7, letter: 'r' },
        { x: 7, y: 7, letter: 'b' },
        { x: 8, y: 7, letter: 'o' },
      ],
      0,
      false,
    );
    expect(r.ok).toBe(true);
    expect(r.word).toBe('rcabo');
    expect(r.newMask.filter(Boolean).length).toBe(3);
    expect(r.newMask.filter((m) => !m).length).toBe(2);
  });

  it('rejects gapped placements', () => {
    const b = empty();
    place(b, [{ x: 5, y: 7, letter: 'c' }]);
    const r = evaluateRun(
      b,
      [
        { x: 4, y: 7, letter: 'x' },
        { x: 7, y: 7, letter: 'y' },
      ],
      0,
      false,
    );
    expect(r.ok).toBe(false);
  });

  it('detects cross words formed perpendicular to the play', () => {
    const b = empty();
    place(b, [
      { x: 7, y: 7, letter: 'c' },
      { x: 8, y: 7, letter: 'a' },
      { x: 9, y: 7, letter: 't' },
    ]);
    // N,T below A -> main vertical word "ant" through the existing A
    const r = evaluateRun(
      b,
      [
        { x: 8, y: 8, letter: 'n' },
        { x: 8, y: 9, letter: 't' },
      ],
      1,
      false,
    );
    expect(r.ok).toBe(true);
    expect(r.word).toBe('ant');
    expect(r.formedWords).toContain('ant');
  });

  it('blocks overwrites and single-letter plays', () => {
    const b = empty();
    place(b, [{ x: 7, y: 7, letter: 'x' }]);
    expect(evaluateRun(b, [{ x: 7, y: 7, letter: 'y' }], 0, true).ok).toBe(false);
    expect(evaluateRun(empty(), [{ x: 7, y: 7, letter: 'q' }], 0, true).ok).toBe(false);
    expect(evaluateRun(empty(), [], 0, true).ok).toBe(false);
  });
});
