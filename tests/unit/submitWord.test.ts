import { describe, it, expect } from 'vitest';
import * as anchor from '@coral-xyz/anchor';
import { BorshCoder } from '@coral-xyz/anchor';
import fs from 'node:fs';
import path from 'node:path';
import { PublicKey } from '@solana/web3.js';
import { encodeSubmitWordData } from '../../app/src/lib/submitWord';

const idl = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../target/idl/crypto_scrabble.json'), 'utf8'),
) as anchor.Idl;
const coder = new BorshCoder(idl);

const dummyMints: Record<string, PublicKey> = {};
for (const l of 'abcdefghijklmnopqrstuvwxyz') dummyMints[l] = PublicKey.default;

// Build an Anchor-style args object (matches the generated IDL client shape).
function anchorArgs(mainProof: number[][], crossProofs: number[][][]) {
  return {
    start_x: 6,
    start_y: 7,
    direction: 0,
    letters: Buffer.from('cat', 'ascii'),
    new_mask: [true, true, true],
    blank_mask: [false, false, false],
    leaf_index: 42,
    proof: mainProof,
    cross_words: crossProofs.map((p, i) => ({ leaf_index: 100 + i, proof: p })),
  };
}

function sib(a: number): number[] {
  return Array.from({ length: 32 }, (_, i) => (a + i) % 256);
}

describe('submitWord hand encoding matches Anchor serialization', () => {
  function compare(params: ReturnType<typeof makeParams>, mainProof: number[][], crossProofs: number[][][]) {
    const hand = encodeSubmitWordData(params, dummyMints);
    const anchorArgsData = coder.types.encode('SubmitWordArgs', anchorArgs(mainProof, crossProofs));
    // hand = 8-byte discriminator + args; compare the args portion only
    expect(hand.slice(8).equals(anchorArgsData)).toBe(true);
  }

  function makeParams(crosses: { leafIndex: number; proof: Uint8Array[] }[]) {
    return {
      player: PublicKey.default,
      startX: 6,
      startY: 7,
      direction: 0 as 0 | 1,
      letters: Uint8Array.from(Buffer.from('cat', 'ascii')),
      newMask: [true, true, true],
      blankMask: [false, false, false],
      leafIndex: 42,
      proof: [sib(1), sib(2)].map((s) => Uint8Array.from(s)),
      crossWords: crosses,
    };
  }

  it('encodes submit_word args byte-identical to the IDL coder (no crosses)', () => {
    compare(makeParams([]), [sib(1), sib(2)], []);
  });

  it('encodes submit_word args byte-identical to the IDL coder (with crosses)', () => {
    const crosses = [[sib(3)], [sib(4), sib(5)]].map((p, i) => ({
      leafIndex: 100 + i,
      proof: p.map((s) => Uint8Array.from(s)),
    }));
    compare(makeParams(crosses), [sib(1), sib(2)], [[sib(3)], [sib(4), sib(5)]]);
  });
});
