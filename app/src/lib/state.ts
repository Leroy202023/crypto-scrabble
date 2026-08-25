import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { boardPda, configPda, vaultPda } from '@shared/program';

export const RPC_URL =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_RPC_URL ??
  'http://127.0.0.1:8899';

/** Program id is baked at build time; PDAs are deterministic from it. */
export const PROGRAM_ID = new PublicKey('53h7akfbCsPwDPQax7ANViJp7gSs9BGn4bY4p9zFkrUT');
export const CONFIG = configPda(PROGRAM_ID);
export const BOARD = boardPda(PROGRAM_ID);
export const VAULT = vaultPda(PROGRAM_ID);
export const TOKEN_PROGRAM = TOKEN_2022_PROGRAM_ID;

export const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
export const DEFAULT_ENTRY_FEE_SOL = 0.05;
export const DEFAULT_PAYOUT_PER_POINT_SOL = 0.005;
export const DEFAULT_BURN_QTY = 1000;

export type Deployment = {
  cluster: string;
  programId: string;
  vault: string;
  merkleRoot: string;
  economy: {
    entryFeeLamports: string;
    payoutPerPointLamports: string;
    burnQuantityPerTile: string;
  };
};

let depPromise: Promise<Deployment | null> | null = null;

/** deployment.json is produced by `npm run init:game` and served from /public. */
export function loadDeployment(): Promise<Deployment | null> {
  if (!depPromise) {
    depPromise = fetch('/deployment.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return depPromise;
}

export type Economy = {
  entryFeeSol: number;
  perPointSol: number;
  burnQty: number;
};

export async function loadEconomy(): Promise<Economy> {
  const dep = await loadDeployment();
  if (!dep?.economy)
    return {
      entryFeeSol: DEFAULT_ENTRY_FEE_SOL,
      perPointSol: DEFAULT_PAYOUT_PER_POINT_SOL,
      burnQty: DEFAULT_BURN_QTY,
    };
  return {
    entryFeeSol: Number(dep.economy.entryFeeLamports) / LAMPORTS_PER_SOL,
    perPointSol: Number(dep.economy.payoutPerPointLamports) / LAMPORTS_PER_SOL,
    burnQty: Number(dep.economy.burnQuantityPerTile),
  };
}

/** letter -> mint pubkey (from letters.json served at /public). */
let mintsPromise: Promise<Record<string, PublicKey>> | null = null;
export function letterMints(): Promise<Record<string, PublicKey>> {
  if (!mintsPromise) {
    mintsPromise = fetch('/letters.json')
      .then((r) => r.json())
      .then((j: { mints: Record<string, { mint: string }> }) => {
        const map: Record<string, PublicKey> = {};
        for (const [l, v] of Object.entries(j.mints)) map[l] = new PublicKey(v.mint);
        return map;
      });
  }
  return mintsPromise;
}

export function connection(): Connection {
  return new Connection(RPC_URL, 'confirmed');
}

export function shortAddr(a: string): string {
  return a.slice(0, 4) + '…' + a.slice(-4);
}

export function sol(n: number): string {
  return n.toFixed(4) + ' SOL';
}
