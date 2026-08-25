import { buildTree, getProof, MerkleTree, verifyProof, wordToLeaf } from '@shared/merkle';
import { loadDeployment } from './state';

let treePromise: Promise<MerkleTree | null> | null = null;

/**
 * Fetches the public-domain dictionary and builds the same SHA-256 merkle
 * tree the launch script stored on-chain. Built lazily on first play.
 */
export function getTree(): Promise<MerkleTree | null> {
  if (!treePromise) {
    treePromise = (async () => {
      const res = await fetch('/dictionary.txt');
      const text = await res.text();
      const words = text
        .split('\n')
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length >= 2 && /^[a-z]+$/.test(w));
      console.info(`[dict] built tree over ${words.length} words`);
      return buildTree(words);
    })();
  }
  return treePromise;
}

/** Returns a proof if `word` is in the dictionary, else null. */
export async function proofForWord(
  word: string,
): Promise<{ leafIndex: number; proof: Uint8Array[] } | null> {
  const [tree, dep] = await Promise.all([getTree(), loadDeployment()]);
  if (!tree || !dep) return null;
  const leaf = wordToLeaf(word.toLowerCase());
  const leafIndex = tree.leaves.findIndex((l) => Buffer.from(l).equals(Buffer.from(leaf)));
  if (leafIndex < 0) return null;
  const proof = getProof(tree, leafIndex);
  const rootBytes = Uint8Array.from(Buffer.from(dep.merkleRoot, 'hex'));
  if (!verifyProof(rootBytes, word.toLowerCase(), leafIndex, proof)) return null;
  return { leafIndex, proof: [...proof] };
}
