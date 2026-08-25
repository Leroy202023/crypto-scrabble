import { useEffect, useState } from 'react';
import { LETTERS, letterMints, sol } from '../lib/state';

type Props = { balances: Record<string, bigint>; burnQty: number };

export default function MarketPanel({ balances, burnQty }: Props) {
  const [links, setLinks] = useState<{ letter: string; url: string; missing: boolean }[]>([]);

  useEffect(() => {
    letterMints().then((mints) => {
      setLinks(
        LETTERS.map((l) => ({
          letter: l.toUpperCase(),
          url: `https://jup.ag/swap/SOL-${mints[l]?.toBase58() ?? ''}`,
          missing: (balances[l] ?? 0n) < BigInt(burnQty || 1),
        })),
      );
    });
  }, [balances]);

  return (
    <div className="panel">
      <h3>Raid the Market — buy missing letters</h3>
      <div className="marketgrid">
        {links
          .filter((l) => l.missing)
          .map((l) => (
            <a key={l.letter} className="mkt" href={l.url} target="_blank" rel="noreferrer">
              ${l.letter}
              <small>buy</small>
            </a>
          ))}
        {links.every((l) => !l.missing) && <span>Full rack. Go play.</span>}
      </div>
    </div>
  );
}
