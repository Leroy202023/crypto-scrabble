import { LETTERS, letterMints } from '../lib/state';

/** "Raid the market" — Jupiter swap links for letters you're missing. */
export default async function marketLinks(): Promise<{ letter: string; url: string }[]> {
  const mints = await letterMints();
  return LETTERS.map((l) => ({
    letter: l.toUpperCase(),
    url: `https://jup.ag/swap/So11111111111111111111111111111111111111112-${mints[l]?.toBase58() ?? ''}`,
  }));
}
