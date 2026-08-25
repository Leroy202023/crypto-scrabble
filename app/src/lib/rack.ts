import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';
import { LETTERS, TOKEN_PROGRAM, connection, letterMints } from './state';

export type RackBalances = Record<string, bigint>; // letter -> token amount

const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const ataOf = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM,
  )[0];

/** Reads the connected wallet's balance of all 26 letter tokens. */
export function useRack(owner: PublicKey | null, tick = 0): RackBalances {
  const [balances, setBalances] = useState<RackBalances>({});

  useEffect(() => {
    let cancelled = false;
    if (!owner) {
      setBalances({});
      return;
    }
    (async () => {
      try {
        const conn = connection();
        const mints = await letterMints();
        const entries = await Promise.all(
          LETTERS.map(async (l) => {
            const mint = mints[l];
            if (!mint) return [l, 0n] as const;
            try {
              const acct = await getAccount(conn, ataOf(owner, mint), 'confirmed', TOKEN_PROGRAM);
              return [l, acct.amount] as const;
            } catch {
              return [l, 0n] as const;
            }
          }),
        );
        if (!cancelled) setBalances(Object.fromEntries(entries));
      } catch (e) {
        console.warn('rack load failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner?.toBase58(), tick]);

  return balances;
}
