import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { boardPda, configPda, vaultPda } from '@shared/program';
import { getCluster, getClusterKey, getProgramId as clusterProgramId } from './clusters';

/** RPC endpoint for the currently selected cluster (see ./clusters). */
export function getRpcUrl(): string {
  return getCluster().rpc;
}

/** Program id is selected at runtime from the active cluster. */
export function getProgramId(): PublicKey {
  return clusterProgramId();
}

export const CONFIG = () => configPda(getProgramId());
export const BOARD = () => boardPda(getProgramId());
export const VAULT = () => vaultPda(getProgramId());
export const TOKEN_PROGRAM = TOKEN_2022_PROGRAM_ID;

export const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
export const BLANK_KEY = '*';
export const DEFAULT_ENTRY_FEE_SOL = 0.05;
export const DEFAULT_PAYOUT_PER_POINT_SOL = 0.005;
export const DEFAULT_BURN_QTY = 1000;

export type Deployment = {
  cluster: string;
  programId: string;
  config: string;
  board: string;
  vault: string;
  merkleRoot: string;
  economy: {
    entryFeeLamports: string;
    payoutPerPointLamports: string;
    burnQuantityPerTile: string;
  };
};

// ---- deployment.json (cluster-aware) ----
let depPromise: Promise<Deployment | null> | null = null;
let depCluster: string | null = null;

function deploymentUrl(): string {
  return `/deployment.${getClusterKey()}.json`;
}

/** deployment.<cluster>.json is produced by `npm run init:game`; falls back to /deployment.json. */
export function loadDeployment(): Promise<Deployment | null> {
  const key = getClusterKey();
  if (!depPromise || depCluster !== key) {
    depCluster = key;
    depPromise = fetch(deploymentUrl())
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => d ?? fetch('/deployment.json').then((r) => (r.ok ? r.json() : null)).catch(() => null));
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

// ---- letters.json (cluster-aware) ----
/** letter -> mint pubkey, served per-cluster as /letters.<cluster>.json. */
let mintsPromise: Promise<Record<string, PublicKey>> | null = null;
let mintsCluster: string | null = null;

export function letterMints(): Promise<Record<string, PublicKey>> {
  const key = getClusterKey();
  if (!mintsPromise || mintsCluster !== key) {
    mintsCluster = key;
    const load = (url: string) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { mints: Record<string, { mint: string }> } | null) => {
          if (!j?.mints) return null;
          const map: Record<string, PublicKey> = {};
          for (const [l, v] of Object.entries(j.mints)) map[l] = new PublicKey(v.mint);
          return map;
        });
    mintsPromise = load(`/letters.${key}.json`)
      .then((m) => m ?? load('/letters.json'))
      .then((m) => m ?? {});
  }
  return mintsPromise;
}

export function connection(): Connection {
  return new Connection(getRpcUrl(), 'confirmed');
}

export function shortAddr(a: string): string {
  return a.slice(0, 4) + '…' + a.slice(-4);
}

export function sol(n: number): string {
  return n.toFixed(4) + ' SOL';
}
