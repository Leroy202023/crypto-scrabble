// Shared merkle utilities for Crypto Scrabble.
// MUST stay byte-compatible with the Rust verifier in
// program/src/instructions/submit_word.rs (verify_merkle_proof):
//   leaf      = sha256(utf8(word))          (word lowercase a-z)
//   node      = sha256(left || right)
//   pad       = repeat the final leaf until the leaf count is a power of two
//   proof     = sibling hashes nearest-first; index bit i tells which side
import { sha256 } from '@noble/hashes/sha256';

export type MerkleTree = {
  leaves: Uint8Array[];
  levels: Uint8Array[][]; // levels[0] = padded leaves, last = [root]
  root: Uint8Array;
};

export function wordToLeaf(word: string): Uint8Array {
  return sha256(new TextEncoder().encode(word.toLowerCase()));
}

function hashPair(left: Uint8Array, right: Uint8Array): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set(left, 0);
  buf.set(right, 32);
  return sha256(buf);
}

export function buildTree(words: string[]): MerkleTree {
  if (words.length < 2) throw new Error('need at least 2 words');
  const sorted = [...words].map((w) => w.trim().toLowerCase()).sort();
  let level = sorted.map(wordToLeaf);
  // pad to next power of two by repeating the last leaf
  let p = 1;
  while (p < level.length) p <<= 1;
  while (level.length < p) level.push(level[level.length - 1]);

  const levels: Uint8Array[][] = [level];
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(hashPair(level[i], level[i + 1]));
    levels.push(next);
    level = next;
  }
  return { leaves: levels[0], levels, root: level[0] };
}

/** Sibling hashes nearest-first — exactly what submit_word expects. */
export function getProof(tree: MerkleTree, leafIndex: number): Uint8Array[] {
  const proof: Uint8Array[] = [];
  let idx = leafIndex;
  for (let l = 0; l < tree.levels.length - 1; l++) {
    const level = tree.levels[l];
    const sibIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    proof.push(level[sibIdx]);
    idx = idx >> 1;
  }
  return proof;
}

export function rootHex(root: Uint8Array): string {
  return Buffer.from(root).toString('hex');
}

/** Verify a proof in JS (mirror of on-chain logic, used in tests). */
export function verifyProof(
  root: Uint8Array,
  word: string,
  leafIndex: number,
  proof: Uint8Array[],
): boolean {
  let current = wordToLeaf(word);
  let idx = leafIndex;
  for (const sib of proof) {
    current = idx % 2 === 0 ? hashPair(current, sib) : hashPair(sib, current);
    idx >>= 1;
  }
  return Buffer.from(current).equals(Buffer.from(root));
}
