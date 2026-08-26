import { describe, expect, it } from 'vitest';
import {
  commitmentOf,
  drawContents,
  RARE_LETTERS,
  TILE_UNITS,
  TIERS,
  verifyReveal,
} from '../../shared/bags';

describe('bags rarity engine', () => {
  it('is deterministic for a given secret + index', () => {
    const a = drawContents('test-secret', 7);
    const b = drawContents('test-secret', 7);
    expect(a.contents).toEqual(b.contents);
    expect(a.tier).toBe(b.tier);
    expect(drawContents('other', 7).contents).not.toEqual(a.contents);
  });

  it('hits the 5/25/70 tier distribution within tolerance', () => {
    const N = 10_000;
    const counts = { common: 0, rare: 0, legendary: 0 };
    for (let i = 0; i < N; i++) counts[drawContents('dist', i).tier]++;
    expect(counts.legendary / N).toBeGreaterThan(0.035);
    expect(counts.legendary / N).toBeLessThan(0.065);
    expect(counts.rare / N).toBeGreaterThan(0.22);
    expect(counts.rare / N).toBeLessThan(0.28);
    expect(counts.common / N).toBeGreaterThan(0.67);
    expect(counts.common / N).toBeLessThan(0.73);
  });

  it('honors tier tile counts and guarantees', () => {
    for (let i = 0; i < 300; i++) {
      const bag = drawContents('guarantees', i);
      const tiles = Object.values(bag.contents).reduce((a, b) => a + b, 0) / TILE_UNITS;
      expect(tiles).toBe(TIERS[bag.tier].tiles);

      const letters = Object.keys(bag.contents);
      if (bag.tier === 'legendary') {
        expect(letters).toContain('*');
        // '?' guarantee -> at least one rare letter
        expect(letters.some((l) => (RARE_LETTERS as readonly string[]).includes(l))).toBe(true);
      }
      if (bag.tier === 'rare') {
        expect(letters.some((l) => (RARE_LETTERS as readonly string[]).includes(l))).toBe(true);
      }
    }
  });

  it('commitments verify and detect tampering', () => {
    const bag = drawContents('tamper', 3);
    expect(verifyReveal(bag)).toBe(true);
    const forged = { ...bag, contents: { ...bag.contents, e: 999_999 } };
    expect(verifyReveal(forged)).toBe(false);
    expect(commitmentOf(bag.salt, bag.contents)).toMatch(/^[0-9a-f]{64}$/);
  });
});
