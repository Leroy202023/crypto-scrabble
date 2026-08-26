// Local playtest — plays a real word against the live validator using the
// production 172k-word dictionary merkle tree, then verifies the burn + payout.
//   tsx scripts/local_playtest.ts
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { buildTree, getProof, wordToLeaf } from '../shared/merkle';

const PROGRAM_ID = new PublicKey('AJVQGSNjciPGhotWNtoRSocWEVWGtFQNqkSVzmgiYMtx');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const cfgPda = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)[0];
const boardPda = PublicKey.findProgramAddressSync([Buffer.from('board')], PROGRAM_ID)[0];
const vaultPda = PublicKey.findProgramAddressSync([Buffer.from('vault')], PROGRAM_ID)[0];

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(p, 'utf8'))));
}

async function main() {
  const rpc = process.env.RPC_URL ?? 'http://127.0.0.1:8899';
  const conn = new Connection(rpc, 'confirmed');
  const player = loadKeypair(process.env.AUTHORITY_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`);
  const wallet = new anchor.Wallet(player);
  const provider = new anchor.AnchorProvider(conn, wallet, { commitment: 'confirmed' });
  const idl = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname!, '../target/idl/crypto_scrabble.json'), 'utf8'),
  ) as anchor.Idl;
  // anchor 0.32: Program is (idl, provider) — programId comes from idl.address.
  const program = new anchor.Program(idl, provider);

  const dep = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname!, '../deployment.json'), 'utf8'));
  const letters = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname!, '../letters.json'), 'utf8'));

  // build the dict tree
  const dict = fs
    .readFileSync(path.resolve(import.meta.dirname!, '../data/dictionary.txt'), 'utf8')
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 2 && /^[a-z]+$/.test(w));
  const tree = buildTree(dict);
  console.log(`[playtest] dict tree over ${dict.length} words; root ${Buffer.from(tree.root).toString('hex')}`);
  console.log(`[playtest] on-chain root ${dep.merkleRoot}`);
  if (Buffer.from(tree.root).toString('hex') !== dep.merkleRoot) throw new Error('dict root mismatch');

  const word = (process.argv[2] ?? 'cat').toLowerCase();
  const leafIndex = tree.leaves.findIndex((l) => Buffer.from(l).equals(Buffer.from(wordToLeaf(word))));
  if (leafIndex < 0) throw new Error(`"${word}" not in dictionary`);

  // Placement (override for connecting plays): START_X/START_Y/DIRECTION env, and
  // BRIDGE = number of leading letters that already exist on the board (bridged).
  const startX = Number(process.env.START_X ?? 7 - Math.floor(word.length / 2));
  const startY = Number(process.env.START_Y ?? 7);
  const direction = Number(process.env.DIRECTION ?? 0);
  const bridge = Number(process.env.BRIDGE ?? 0);
  const lettersBytes = Buffer.from(word, 'ascii');
  const newMask = Array.from({ length: word.length }, (_, i) => i >= bridge);

  const proof = getProof(tree, leafIndex).map((p) => Buffer.from(p));
  const pdaOf = (m: PublicKey) =>
    getAssociatedTokenAddressSync(m, player.publicKey, false, TOKEN_2022_PROGRAM_ID, ATA_PROGRAM);

  // only newly placed letters need a mint + ATA
  const mints = [...word].filter((_, i) => i >= bridge).map((c) => new PublicKey(letters.mints[c].mint));
  const before = await conn.getBalance(player.publicKey);
  const vaultBefore = await conn.getBalance(vaultPda);
  const cfgBefore = (await program.account.gameConfig.fetch(configPda)) as { totalPayoutLamports: bigint; entryFeeLamports: bigint };

  console.log(`[playtest] playing "${word}" at (${startX},${startY}) dir ${direction} bridge ${bridge}`);
  await program.methods
    .submitWord({
      startX,
      startY,
      direction,
      letters: lettersBytes,
      newMask,
      blankMask: Array.from({ length: word.length }, () => false),
      leafIndex,
      proof,
      crossWords: [],
    })
    .accounts({ player: player.publicKey, config: cfgPda, board: boardPda, vault: vaultPda, tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .remainingAccounts(
      mints.flatMap((m) => [
        { pubkey: m, isSigner: false, isWritable: true },
        { pubkey: pdaOf(m), isSigner: false, isWritable: true },
      ]),
    )
    .rpc();

  // verify burns
  for (const c of word) {
    const acct = await getAccount(conn, pdaOf(new PublicKey(letters.mints[c].mint)), 'confirmed', TOKEN_2022_PROGRAM_ID);
    console.log(`[playtest]   $${c.toUpperCase()} balance after burn: ${acct.amount}`);
  }

  const after = await conn.getBalance(player.publicKey);
  const vaultAfter = await conn.getBalance(vaultPda);
  const board = await (program.account as any).gameBoard.fetch(boardPda);
  const cfg = await (program.account as any).gameConfig.fetch(cfgPda);

  const payoutLamports = Number(cfg.totalPayoutLamports) - Number(cfgBefore.totalPayoutLamports);
  console.log(`[playtest] payout for this word: ${payoutLamports} lamports (${(payoutLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL)`);
  console.log(`[playtest] player SOL delta ${(after - before) / LAMPORTS_PER_SOL} SOL (entry ${Number(cfg.entryFeeLamports) / LAMPORTS_PER_SOL} - payout ${(payoutLamports / LAMPORTS_PER_SOL).toFixed(4)} - tx fees)`);
  console.log(`[playtest] vault SOL delta ${(vaultAfter - vaultBefore) / LAMPORTS_PER_SOL} SOL`);
  console.log(`[playtest] board words_played = ${board.wordsPlayed}`);
  console.log(`[playtest] config total_payout_lamports = ${cfg.totalPayoutLamports}`);
  console.log(`[playtest] config total_burned_units = ${cfg.totalBurnedUnits}`);
  console.log('[playtest] OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
