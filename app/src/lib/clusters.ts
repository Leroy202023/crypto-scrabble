import { useSyncExternalStore } from 'react';
import { PublicKey } from '@solana/web3.js';

export type ClusterKey = 'localnet' | 'devnet' | 'mainnet';

export type ClusterDef = {
  key: ClusterKey;
  label: string;
  rpc: string;
  /** On-chain program id for this cluster ('' when not yet deployed). */
  programId: string;
  /** Whether the program + mints have been deployed to this cluster. */
  deployed: boolean;
  explorer: string;
};

// Localnet and devnet share the same program id because we control its keypair
// (target/deploy/crypto_scrabble-keypair.json). Mainnet is a placeholder until
// the program is deployed there.
const PROGRAM_ID = 'AJVQGSNjciPGhotWNtoRSocWEVWGtFQNqkSVzmgiYMtx';

export const CLUSTERS: Record<ClusterKey, ClusterDef> = {
  localnet: {
    key: 'localnet',
    label: 'Localnet',
    rpc: 'http://127.0.0.1:8899',
    programId: PROGRAM_ID,
    deployed: true,
    explorer: 'https://explorer.solana.com',
  },
  devnet: {
    key: 'devnet',
    label: 'Devnet',
    rpc: 'https://api.devnet.solana.com',
    programId: PROGRAM_ID,
    deployed: true,
    explorer: 'https://explorer.solana.com',
  },
  mainnet: {
    key: 'mainnet',
    label: 'Mainnet',
    // Replace with the deployed mainnet program id before going live.
    rpc: 'https://api.mainnet-beta.solana.com',
    programId: '',
    deployed: false,
    explorer: 'https://explorer.solana.com',
  },
};

export const CLUSTER_ORDER: ClusterKey[] = ['localnet', 'devnet', 'mainnet'];

const STORAGE_KEY = 'cs_cluster';
const listeners = new Set<() => void>();

function readStored(): ClusterKey {
  if (typeof localStorage === 'undefined') return 'devnet';
  const v = localStorage.getItem(STORAGE_KEY) as ClusterKey | null;
  return v && CLUSTERS[v] ? v : 'devnet';
}

let current: ClusterKey = readStored();

export function getClusterKey(): ClusterKey {
  return current;
}
export function getCluster(): ClusterDef {
  return CLUSTERS[current];
}
export function setClusterKey(k: ClusterKey): void {
  if (!CLUSTERS[k]) return;
  current = k;
  try {
    localStorage.setItem(STORAGE_KEY, k);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
export function onClusterChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React hook: re-renders when the selected cluster changes. */
export function useClusterKey(): ClusterKey {
  return useSyncExternalStore(onClusterChange, getClusterKey, getClusterKey);
}

export function getProgramId(): PublicKey {
  const id = getCluster().programId;
  if (!id) throw new Error(`Program not deployed on ${getCluster().label}`);
  return new PublicKey(id);
}
