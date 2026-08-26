import { LETTERS, BLANK_KEY, letterMints } from './state';

export type PriceInfo = { price: number; source: 'jupiter' | 'est' };

const JUP = 'https://lite-api.jup.ag/price/v3';
const TTL = 30_000;
let cache: { t: number; v: Record<string, PriceInfo> } | null = null;

async function lettersSupply(): Promise<Record<string, number>> {
  const j = await fetch('/letters.json').then((r) => r.json());
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(j.mints ?? {})) {
    out[k] = Number((v as { supply: string }).supply) || 1;
  }
  return out;
}

/**
 * Price (in SOL) of each letter token. Tries Jupiter's live price feed; any
 * letter it can't resolve (localnet mints, rate limits) falls back to a
 * scarcity estimate: price ∝ 1 / supply, so rare letters cost more — matching
 * the actual Token-2022 supply each letter mint was launched with.
 */
export async function loadPrices(): Promise<Record<string, PriceInfo>> {
  if (cache && Date.now() - cache.t < TTL) return cache.v;

  const mints = await letterMints();
  const supply = await lettersSupply();
  // anchor the estimate so the commonest letter (e) is ~0.002 SOL
  const k = 0.002 * (supply['e'] || 1_200_000_000);
  const est = (l: string) => Math.max(0.00005, k / (supply[l] || 1));

  const map: Record<string, PriceInfo> = {};
  try {
    const ids = Object.values(mints).map((m) => m.toBase58());
    const j = await fetch(`${JUP}?ids=${ids.join(',')}`).then((r) => r.json());
    if (j?.data) {
      for (const l of [...LETTERS, BLANK_KEY]) {
        const m = mints[l];
        if (!m) continue;
        const p = j.data[m.toBase58()]?.price;
        if (p != null && Number(p) > 0) map[l] = { price: Number(p), source: 'jupiter' };
      }
    }
  } catch {
    /* offline/localnet — use estimates */
  }
  for (const l of [...LETTERS, BLANK_KEY]) {
    if (!map[l]) map[l] = { price: est(l), source: 'est' };
  }
  cache = { t: Date.now(), v: map };
  return map;
}

export function formatSol(n: number): string {
  if (n >= 1) return `${n.toFixed(2)}`;
  if (n >= 0.001) return n.toFixed(4);
  return n.toFixed(6);
}
