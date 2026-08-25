import { RackBalances } from '../lib/rack';

type Props = {
  balances: RackBalances;
  burnQty: number;
  selected: string | null;
  onSelect: (letter: string) => void;
};

export default function Rack({ balances, burnQty, selected, onSelect }: Props) {
  return (
    <div className="panel">
      <h3>Your Tile Rack — wallet balances</h3>
      <div className="rack">
        {'abcdefghijklmnopqrstuvwxyz'.split('').map((l) => {
          const amt = balances[l] ?? 0n;
          const canPlay = amt >= BigInt(burnQty || 1);
          return (
            <button
              key={l}
              className={`tilebtn ${!canPlay ? 'zero' : ''} ${selected === l ? 'selected' : ''}`}
              disabled={!canPlay}
              onClick={() => onSelect(l)}
              title={canPlay ? `${amt} $${l.toUpperCase()}` : `need ${burnQty} $${l.toUpperCase()} to place`}
            >
              {l.toUpperCase()}
              <small>{Number(amt).toLocaleString()}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}
