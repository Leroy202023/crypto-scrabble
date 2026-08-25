// Step 1 — launch the 26 letter tokens.
//
// Each letter is a Token-2022 mint with the TransferFee extension:
//   - 2% (200 bps) of EVERY transfer is withheld as fees
//   - withheld fees are swept by the treasury bot, sold for SOL and
//     deposited into the game vault (the "Volume Tax" funding stream)
//
// Supply is frequency-weighted: common letters are abundant, Q/Z are scarce,
// so vowels stay liquid while high-value letters appreciate as they burn.
//
// Env:
//   RPC_URL            (default localnet)
//   AUTHORITY_KEYPAIR  path to the mint/upgrade authority keypair
//   TREASURY_PUBKEY    wallet that receives the treasury allocation + fee sweep authority
//   TRANSFER_FEE_BPS   default 200
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createMintToInstruction,
  getAccountLen,
  getMintLen,
} from '@solana/spl-token';

export const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

// Scrabble tile distribution x 1e6 base units. Total ≈ 10B per full set scale.
export const SUPPLY_PER_LETTER: Record<string, bigint> = Object.fromEntries(
  [
    ['a', 900_000_000], ['b', 200_000_000], ['c', 200_000_000],
    ['d', 400_000_000], ['e', 1_200_000_000], ['f', 200_000_000],
    ['g', 300_000_000], ['h', 200_000_000], ['i', 900_000_000],
    ['j', 100_000_000], ['k', 100_000_000], ['l', 400_000_000],
    ['m', 200_000_000], ['n', 600_000_000], ['o', 800_000_000],
    ['p', 200_000_000], ['q', 60_000_000],  ['r', 600_000_000],
    ['s', 400_000_000], ['t', 900_000_000], ['u', 400_000_000],
    ['v', 200_000_000], ['w', 200_000_000], ['x', 60_000_000],
    ['y', 200_000_000], ['z', 60_000_000],
  ].map(([l, n]) => [l, BigInt(n)]),
);

/** Fraction of every letter's supply parked in the treasury at genesis. */
export const TREASURY_ALLOCATION_BPS = 800; // 8%

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(p, 'utf8'))));
}

async function main() {
  const connection = new Connection(process.env.RPC_URL ?? 'http://127.0.0.1:8899', 'confirmed');
  const authority = loadKeypair(process.env.AUTHORITY_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`);
  const treasury = new PublicKey(
    process.env.TREASURY_PUBKEY ?? authority.publicKey.toBase58(),
  );
  const feeBps = Number(process.env.TRANSFER_FEE_BPS ?? 200);
  const maxFee = 2n ** 63n - 1n; // effectively uncapped absolute fee

  const balances = await Promise.all([
    connection.getBalance(authority.publicKey),
    connection.getBalance(treasury),
  ]);
  console.log(`authority ${authority.publicKey.toBase58()} balance ${(balances[0] / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  console.log(`treasury  ${treasury.toBase58()} balance ${(balances[1] / LAMPORTS_PER_SOL).toFixed(3)} SOL`);

  const out: Record<string, { mint: string; decimals: number; supply: string }> = {};
  for (const letter of LETTERS) {
    const mintKeypair = Keypair.generate();
    const supply = SUPPLY_PER_LETTER[letter];
    const treasuryAmount = (supply * BigInt(TREASURY_ALLOCATION_BPS)) / 10_000n;

    const space = getMintLen([ExtensionType.TransferFeeConfig]);
    const lamports = await connection.getMinimumBalanceForRentExemption(space);

    const ata = PublicKey.findProgramAddressSync(
      [treasury.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mintKeypair.publicKey.toBuffer()],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
    )[0];

    const ixs: TransactionInstruction[] = [
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferFeeConfigInstruction(
        mintKeypair.publicKey,
        null, // transfer fee config authority -> mint authority
        treasury, // withdraw withheld fees authority (bot/treasury)
        feeBps,
        maxFee,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        0, // zero decimals: tiles are indivisible
        authority.publicKey,
        null, // no freeze authority
        TOKEN_2022_PROGRAM_ID,
      ),
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        ata,
        treasury,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
      ),
      createMintToInstruction(mintKeypair.publicKey, ata, authority.publicKey, supply, [], TOKEN_2022_PROGRAM_ID),
    ];

    const msg = new TransactionMessage({
      payerKey: authority.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: ixs,
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([mintKeypair, authority]);
    const sig = await connection.sendTransaction(tx, { maxRetries: 5 });
    await connection.confirmTransaction(sig, 'confirmed');

    out[letter] = { mint: mintKeypair.publicKey.toBase58(), decimals: 0, supply: supply.toString() };
    console.log(`$${letter.toUpperCase()} mint ${mintKeypair.publicKey.toBase58()} supply ${supply}`);
  }

  const dest = path.resolve(import.meta.dirname!, '../letters.json');
  fs.writeFileSync(
    dest,
    JSON.stringify({ cluster: process.env.RPC_URL ?? 'localnet', authority: authority.publicKey.toBase58(), treasury: treasury.toBase58(), transferFeeBps: feeBps, mints: out }, null, 2),
  );
  console.log(`wrote ${dest}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
