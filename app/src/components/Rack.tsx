import { useState } from 'react';
import { RackBalances } from '../lib/rack';
import { BLANK_KEY } from '../lib/state';
import { PriceInfo, formatSol } from '../lib/prices';

type Props = {
  balances: RackBalances;
  burnQty: number;
  prices: Record<string, PriceInfo>;
  selected: string | null;
  onSelect: (letter: string) => void;
  /** connected wallet address — shown with a starter-rack hint when empty */
  address?: string;
};

export default function Rack({ balances, burnQty, prices, selected, onSelect, address }: Props) {
  const tiles = [...'abcdefghijklmnopqrstuvwxyz', BLANK_KEY];
  const isEmpty = Object.values(balances).every((v) => v === 0n);
  const [copied, setCopied] = useState(false);
  return (
    <div className="panel">
      <h3>Your Tile Rack — wallet balances</h3>
      {isEmpty && address && (
        <p className="rack-empty">
          Your rack is empty. During devnet beta the operator issues starter
          racks — send them this address:{' '}
          <code>{address.slice(0, 4)}…{address.slice(-4)}</code>{' '}
          <button
            className="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(address);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'copied ✓' : 'copy'}
          </button>
        </p>
      )}
      <div className="rack">
        {tiles.map((l) => {
          const isBlank = l === BLANK_KEY;
          const amt = balances[l] ?? 0n;
          const canPlay = amt >= BigInt(burnQty || 1);
          const price = prices[l]?.price;
          const label = isBlank ? '␣' : l.toUpperCase();
          const priceStr = price != null ? `${formatSol(price)}◎` : '';
          return (
            <button
              key={l}
              className={`tilebtn ${isBlank ? 'blanktile' : ''} ${!canPlay ? 'zero' : ''} ${selected === l ? 'selected' : ''}`}
              disabled={!canPlay}
              onClick={() => onSelect(l)}
              title={
                isBlank
                  ? canPlay
                    ? `${amt} blanks — play any letter for 0 points${priceStr ? ` · ${priceStr}` : ''}`
                    : `need ${burnQty} blanks to place`
                  : canPlay
                    ? `${amt} $${label} · ${priceStr}`
                    : `need ${burnQty} $${label} to place`
              }
            >
              {label}
              {priceStr && <span className="price">{priceStr}</span>}
              <small>{Number(amt).toLocaleString()}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}
