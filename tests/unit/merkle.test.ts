import { describe, expect, it } from 'vitest';
import { buildTree, getProof, rootHex, verifyProof, wordToLeaf } from '../../shared/merkle';

const WORDS8 = ['cat', 'quiz', 'zebra', 'apple', 'dog', 'sun', 'moon', 'star'];
const WORDS6 = ['at', 'be', 'cat', 'do', 'eat', 'for']; // padded to 8 leaves

// buildTree sorts words; resolve each word's leaf index from the tree itself
function indexOf(tree: ReturnType<typeof buildTree>, word: string): number {
  const leaf = wordToLeaf(word);
  return tree.leaves.findIndex((l) => Buffer.from(l).equals(Buffer.from(leaf)));
}

describe('merkle', () => {
  it('round-trips every proof in a perfect tree', () => {
    const tree = buildTree(WORDS8);
    expect(tree.levels.at(-1)!.length).toBe(1);
    for (const w of WORDS8) {
      const i = indexOf(tree, w);
      const proof = getProof(tree, i);
      expect(proof.length).toBe(3);
      expect(verifyProof(tree.root, w, i, proof)).toBe(true);
    }
  });

  it('rejects wrong words / indices', () => {
    const tree = buildTree(WORDS8);
    const proof = getProof(tree, indexOf(tree, 'cat'));
    expect(verifyProof(tree.root, 'dog', indexOf(tree, 'cat'), proof)).toBe(false);
    expect(verifyProof(tree.root, 'cata', indexOf(tree, 'cat'), proof)).toBe(false);
  });

  it('handles non-power-of-two dictionaries via leaf padding', () => {
    const tree = buildTree(WORDS6);
    for (const w of WORDS6) {
      expect(verifyProof(tree.root, w, indexOf(tree, w), getProof(tree, indexOf(tree, w)))).toBe(
        true,
      );
    }
  });

  it('is deterministic and case-insensitive', () => {
    const a = buildTree(WORDS8);
    const b = buildTree([...WORDS8].reverse());
    expect(rootHex(a.root)).toBe(rootHex(b.root));
    expect(wordToLeaf('CAT')).toEqual(wordToLeaf('cat'));
  });

  it('proof depth stays within on-chain MAX_PROOF_LEN at dictionary scale', () => {
    const tree = buildTree(Array.from({ length: 172_820 }, (_, i) => `w${i}`.slice(0, 12)));
    expect(tree.levels.length - 1).toBeLessThanOrEqual(24);
  }, 60_000);
});
