// End-to-end blank-tile verification against the live validator.
// Plays "CAT" as the first move with C as a BLANK (scores 0 for the C).
// Expects: blank mint burned, letter a+t burned, score = a(1)+t(1)=2.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { PROGRAM_ID, boardPda, configPda, vaultPda } from '../shared/program';
import { buildTree, getProof, wordToLeaf } from '../shared/merkle';
import { encodeSubmitWordData } from '../app/src/lib/submitWord';

const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
import { createHash } from 'node:crypto';
const sha256 = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(Buffer.from(b)).digest());
function disc(name: string) { return Buffer.from(sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8)); }
const u8 = (n: number) => Buffer.from([n & 0xff]);
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

function loadKeypair(p: string) { return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(p, 'utf8')))); }

async function main() {
  const conn = new Connection(process.env.RPC_URL ?? 'http://127.0.0.1:8899', 'confirmed');
  const player = loadKeypair(process.env.AUTHORITY_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`);
  const letters = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname!, '../letters.json'), 'utf8'));
  const mints: Record<string, PublicKey> = {};
  for (const [k, v] of Object.entries(letters.mints as Record<string, { mint: string }>)) mints[k] = new PublicKey(v.mint);
  const blankMint = mints['*'];

  const dict = fs.readFileSync(path.resolve(import.meta.dirname!, '../data/dictionary.txt'), 'utf8')
    .split('\n').map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2 && /^[a-z]+$/.test(w));
  const tree = buildTree(dict);
  const word = 'cat';
  const leafIndex = tree.leaves.findIndex((l) => Buffer.from(l).equals(Buffer.from(wordToLeaf(word))));
  const proof = getProof(tree, leafIndex).map((p) => Buffer.from(p));

  const startX = 7 - Math.floor(word.length / 2);
  const startY = 7;
  const lettersBytes = Buffer.from(word, 'ascii');
  const newMask = [true, true, true];
  const blankMask = [true, false, false]; // C is a blank

  const data = Buffer.concat([
    disc('submit_word'), u8(startX), u8(startY), u8(0),
    u32(lettersBytes.length), lettersBytes,
    u32(newMask.length), Buffer.from(newMask.map((b) => (b ? 1 : 0))),
    u32(blankMask.length), Buffer.from(blankMask.map((b) => (b ? 1 : 0))),
    u32(leafIndex >>> 0), u32(proof.length), ...proof.map(Buffer.from),
    u32(0),
  ]);

  const ataOf = (m: PublicKey) => getAssociatedTokenAddressSync(m, player.publicKey, false, TOKEN_2022_PROGRAM_ID, ATA_PROGRAM);
  const runMints = [blankMint, mints['a'], mints['t']]; // C=blank, then a, t
  const keys = [
    { pubkey: player.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPda(), isSigner: false, isWritable: true },
    { pubkey: boardPda(), isSigner: false, isWritable: true },
    { pubkey: vaultPda(), isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ...runMints.flatMap((m) => [
      { pubkey: m, isSigner: false, isWritable: true },
      { pubkey: ataOf(m), isSigner: false, isWritable: true },
    ]),
  ];
  const bal = async (m: PublicKey) => (await getAccount(conn, ataOf(m), 'confirmed', TOKEN_2022_PROGRAM_ID)).amount;
  const before = { blank: await bal(blankMint), a: await bal(mints['a']), t: await bal(mints['t']) };

  const ix = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
  const sig = await conn.sendTransaction(new Transaction().add(ix), [player], { skipPreflight: true });
  await conn.confirmTransaction(sig, 'confirmed');
  console.log('submitted:', sig);

  const after = { blank: await bal(blankMint), a: await bal(mints['a']), t: await bal(mints['t']) };
  const delta = (x: bigint, y: bigint) => Number(x - y);
  console.log('blank burn:', delta(before.blank, after.blank), '(expect 1000)');
  console.log('a burn:', delta(before.a, after.a), '(expect 1000)');
  console.log('t burn:', delta(before.t, after.t), '(expect 1000)');
  const ok =
    delta(before.blank, after.blank) === 1000 &&
    delta(before.a, after.a) === 1000 &&
    delta(before.t, after.t) === 1000;
  console.log(ok ? 'BLANK VERIFY: PASS — C was a blank, burned the blank mint' : 'BLANK VERIFY: FAIL');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
