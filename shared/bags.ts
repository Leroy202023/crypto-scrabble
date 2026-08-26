// Scrabble Bags — provably-fair rarity engine.
//
// A "bag" is a sealed pack of letter tokens (units of the 27 Token-2022
// mints). Every bag's contents are drawn deterministically from a per-bag
// seed; buyers can verify the draw afterwards against the commitment that was
// published BEFORE any sales (commit = sha256(salt | canonical contents)).
//
// Tiers:  common 70% · rare 25% · legendary 5%
import { sha256 } from '@noble/hashes/sha256';

export type BagTier = 'common' | 'rare' | 'legendary';

/** Standard Scrabble letter frequency (per 98 lettered tiles). */
export const TILE_FREQUENCY: Record<string, number> = {
  a: 9, b: 2, c: 2, d: 4, e: 12, f: 2, g: 3, h: 2, i: 9, j: 1, k: 1,
  l: 4, m: 2, n: 6, o: 8, p: 2, q: 1, r: 6, s: 4, t: 6, u: 4, v: 2,
  w: 2, x: 1, y: 4, z: 1,
};

export const RARE_LETTERS = ['j', 'q', 'x', 'z', 'k'] as const;
export const BLANK = '*';
/** Units consumed per placed tile by the game — 1 tile in a bag = this many. */
export const TILE_UNITS = 1000;

export interface TierSpec {
  tier: BagTier;
  tiles: number;
  /** guaranteed draws pulled before the weighted fill */
  guaranteed: string[];
}

export const TIERS: Record<BagTier, TierSpec> = {
  common: { tier: 'common', tiles: 7, guaranteed: [] },
  // '?' = random member of RARE_LETTERS
  rare: { tier: 'rare', tiles: 10, guaranteed: ['?'] },
  legendary: { tier: 'legendary', tiles: 14, guaranteed: [BLANK, '?'] },
};

export type BagContents = Record<string, number>; // letter -> units

export interface SealedBag {
  index: number;
  tier: BagTier;
  commitment: string; // hex sha256(salt | canonical(contents))
}
export interface RevealedBag extends SealedBag {
  salt: string;
  contents: BagContents;
}

// ---------- deterministic RNG ----------

function mulberry32(seed: Uint8Array): () => number {
  let a = ((seed[0] << 24) | (seed[1] << 16) | (seed[2] << 8) | seed[3]) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashBytes(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { buf.set(p, off); off += p.length; }
  return sha256(buf);
}

const enc = new TextEncoder();

function seedFor(secret: string, index: number): Uint8Array {
  return hashBytes(enc.encode(secret), enc.encode(':'), enc.encode(String(index)));
}

function rollTier(rand: () => number): BagTier {
  const r = rand() * 100;
  if (r < 5) return 'legendary';
  if (r < 30) return 'rare';
  return 'common';
}

function drawLetter(rand: () => number): string {
  const total = Object.values(TILE_FREQUENCY).reduce((a, b) => a + b, 0); // 98
  let r = rand() * total;
  for (const [letter, weight] of Object.entries(TILE_FREQUENCY)) {
    r -= weight;
    if (r < 0) return letter;
  }
  return 'e';
}

// ---------- contents drawing ----------

export function drawContents(secret: string, index: number): RevealedBag {
  const rand = mulberry32(seedFor(secret, index));
  const spec = TIERS[rollTier(rand)];
  const counts: Record<string, number> = {};

  const give = (letter: string, tiles = 1) => {
    counts[letter] = (counts[letter] ?? 0) + tiles * TILE_UNITS;
  };

  for (const g of spec.guaranteed) {
    // rare-letter guarantee pulls a random member of the pool unless pinned
    give(g === '?' ? RARE_LETTERS[Math.floor(rand() * RARE_LETTERS.length)] : g);
  }
  while (Object.values(counts).reduce((a, b) => a + b, 0) / TILE_UNITS < spec.tiles) {
    give(drawLetter(rand));
  }

  const contents: BagContents = {};
  for (const k of Object.keys(counts).sort()) contents[k] = counts[k];
  const salt = Buffer.from(seedFor(secret, index)).toString('hex');
  return {
    index,
    tier: spec.tier,
    salt,
    contents,
    commitment: commitmentOf(salt, contents),
  };
}

export function canonicalContents(c: BagContents): string {
  return JSON.stringify(Object.keys(c).sort().map((k) => [k, c[k]]));
}

export function commitmentOf(salt: string, contents: BagContents): string {
  return Buffer.from(hashBytes(enc.encode(salt), enc.encode('|'), enc.encode(canonicalContents(contents)))).toString('hex');
}

export function verifyReveal(bag: RevealedBag): boolean {
  return commitmentOf(bag.salt, bag.contents) === bag.commitment;
}
