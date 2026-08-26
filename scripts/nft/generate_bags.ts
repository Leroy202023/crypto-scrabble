// Scaffble Bag generation scaffold — deterministically produces varied bag
// metadata for the NFT collection described in docs/nft-bags.md.
//
//   npx tsx scripts/nft/generate_bags.ts [count] [outDir]
//
// Output:  <outDir>/bags/<index>.json  +  <outDir>/collection_manifest.json
// The loot math here MUST be mirrored by the on-chain `open_bag` instruction.
import fs from 'node:fs';
import path from 'node:path';

const COUNT = Number(process.argv[2] ?? 1000);
const OUT = path.resolve(process.argv[3] ?? 'nft');

// classic Scrabble tile frequencies (also the localnet supply weights)
const FREQ: Record<string, number> = {
  a: 9, b: 2, c: 2, d: 4, e: 12, f: 2, g: 3, h: 2, i: 9, j: 1, k: 1, l: 4,
  m: 2, n: 6, o: 8, p: 2, q: 1, r: 6, s: 4, t: 6, u: 4, v: 2, w: 2, x: 1,
  y: 2, z: 1, '*': 2,
};

type Tier = {
  name: string;
  supplyFrac: number;
  minTiles: number;
  maxTiles: number;
  blankChance: number; // chance of getting the tier's blank count
  blankCount: number;
  highValueTilt: number; // 0..1 extra weight on q/z/j/x
  vowelRich: number; // 0..1 extra weight on a/e/i/o/u
  voucherLamports: number;
};

const TIERS: Tier[] = [
  { name: 'common', supplyFrac: 0.7, minTiles: 12, maxTiles: 16, blankChance: 0.06, blankCount: 1, highValueTilt: 0, vowelRich: 0, voucherLamports: 50_000_000 },
  { name: 'rare', supplyFrac: 0.22, minTiles: 15, maxTiles: 19, blankChance: 0.45, blankCount: 1, highValueTilt: 0.5, vowelRich: 0.15, voucherLamports: 120_000_000 },
  { name: 'legendary', supplyFrac: 0.08, minTiles: 18, maxTiles: 22, blankChance: 1, blankCount: 2, highValueTilt: 0.7, vowelRich: 0.35, voucherLamports: 250_000_000 },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickTier(r: number): Tier {
  let acc = 0;
  for (const t of TIERS) {
    acc += t.supplyFrac;
    if (r <= acc) return t;
  }
  return TIERS[TIERS.length - 1];
}

function buildCdf(tier: Tier): [string, number][] {
  const weights: [string, number][] = Object.entries(FREQ).map(([l, f]) => {
    let w = f;
    if (tier.highValueTilt && 'qzjx'.includes(l)) w *= 1 + tier.highValueTilt * 4;
    if (tier.vowelRich && 'aeiou'.includes(l)) w *= 1 + tier.vowelRich * 2;
    if (l === '*') w = 0; // blanks handled separately
    return [l, w];
  });
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  return weights.map(([l, w]) => {
    acc += w / total;
    return [l, acc];
  });
}

function drawLetter(rng: () => number, cdf: [string, number][]): string {
  const r = rng();
  for (const [l, cum] of cdf) if (r <= cum) return l;
  return cdf[cdf.length - 1][0];
}

function generateBag(index: number, tier: Tier) {
  const rng = mulberry32(index * 2654435761 + 0x9e3779b9);
  const tileCount = tier.minTiles + Math.floor(rng() * (tier.maxTiles - tier.minTiles + 1));
  const cdf = buildCdf(tier);
  const tiles: Record<string, number> = {};
  for (let i = 0; i < tileCount; i++) {
    const l = drawLetter(rng, cdf);
    tiles[l] = (tiles[l] ?? 0) + 1;
  }
  if (rng() < tier.blankChance) {
    tiles['*'] = (tiles['*'] ?? 0) + tier.blankCount;
  }
  // legendary: guarantee a Q or Z so the bag always feels premium
  if (tier.name === 'legendary' && !tiles['q'] && !tiles['z']) {
    const pick = rng() < 0.5 ? 'q' : 'z';
    tiles[pick] = 1;
  }
  const contents = Object.entries(tiles)
    .map(([letter, qty]) => ({ letter, qty }))
    .sort((a, b) => a.letter.localeCompare(b.letter));
  const totalTiles = contents.reduce((s, c) => s + c.qty, 0);
  const blanks = tiles['*'] ?? 0;
  return {
    name: `Scrabble Bag #${index}`,
    tier: tier.name,
    rng_seed: `0x${(index * 2654435761 + 0x9e3779b9).toString(16)}`,
    contents,
    sol_voucher_lamports: tier.voucherLamports,
    attributes: [
      { trait_type: 'Tier', value: tier.name },
      { trait_type: 'Tiles', value: totalTiles },
      { trait_type: 'Blanks', value: blanks },
    ],
  };
}

function main() {
  const bagsDir = path.join(OUT, 'bags');
  fs.mkdirSync(bagsDir, { recursive: true });

  const tierCounts: Record<string, number> = {};
  const manifest: { index: number; tier: string; tiles: number; blanks: number }[] = [];
  const cdfTiers = TIERS.map((t) => ({ name: t.name, cum: 0 }));

  for (let i = 0; i < COUNT; i++) {
    const rng = mulberry32(i + 1);
    const tier = pickTier(rng());
    const bag = generateBag(i, tier);
    fs.writeFileSync(path.join(bagsDir, `${i}.json`), JSON.stringify(bag, null, 2));
    tierCounts[tier.name] = (tierCounts[tier.name] ?? 0) + 1;
    manifest.push({
      index: i,
      tier: bag.tier,
      tiles: bag.contents.reduce((s, c) => s + c.qty, 0),
      blanks: bag.contents.find((c) => c.letter === '*')?.qty ?? 0,
    });
  }

  fs.writeFileSync(
    path.join(OUT, 'collection_manifest.json'),
    JSON.stringify({ count: COUNT, tiers: tierCounts, bags: manifest }, null, 2),
  );
  console.log(`generated ${COUNT} bags -> ${OUT}/bags + collection_manifest.json`);
  console.log('tier split:', tierCounts);
}

main();
