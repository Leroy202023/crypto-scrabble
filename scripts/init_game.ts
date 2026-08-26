// Step 3 — initialize the on-chain game:
//   1. initialize(config, board, vault) with merkle root + economy params
//   2. set_letter_mints(...) with the 26 Token-2022 mints from letters.json
//   3. fund the SOL payout vault
//
// Env:
//   RPC_URL, AUTHORITY_KEYPAIR
//   ENTRY_FEE_SOL          default 0.05
//   PAYOUT_PER_POINT_SOL   default 0.005
//   BURN_QTY               default 1000 (tokens burned per placed tile)
//   VAULT_FUNDING_SOL      default 5
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { PROGRAM_ID, boardPda, configPda, vaultPda } from '../shared/program';
import { clusterFromRpc } from './launch_letters';

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(p, 'utf8'))));
}

// anchor discriminator = sha256("global:<ix_name>")[..8]
async function discriminator(name: string): Promise<Buffer> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
const u64le = (n: bigint | number) => Buffer.from(BigInt.asUintN(64, BigInt(n)).toString(16).padStart(16, '0').match(/../g)!.reverse().map((b) => parseInt(b, 16)));

async function main() {
  const connection = new Connection(process.env.RPC_URL ?? 'http://127.0.0.1:8899', 'confirmed');
  const authority = loadKeypair(process.env.AUTHORITY_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`);

  const letters = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname!, '../letters.json'), 'utf8'));
  const rootHexStr = fs.readFileSync(path.resolve(import.meta.dirname!, '../data/merkle_root.txt'), 'utf8').trim();
  const root = Buffer.from(rootHexStr, 'hex');

  const entryFee = BigInt(Math.round(Number(process.env.ENTRY_FEE_SOL ?? 0.05) * LAMPORTS_PER_SOL));
  const perPoint = BigInt(Math.round(Number(process.env.PAYOUT_PER_POINT_SOL ?? 0.005) * LAMPORTS_PER_SOL));
  const burnQty = BigInt(process.env.BURN_QTY ?? 1000);
  const funding = BigInt(Math.round(Number(process.env.VAULT_FUNDING_SOL ?? 5) * LAMPORTS_PER_SOL));

  // ---- initialize ----
  const blankMint = new PublicKey(letters.mints['*'].mint);
  const initIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: true },
      { pubkey: boardPda(), isSigner: false, isWritable: true },
      { pubkey: vaultPda(), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      await discriminator('initialize'),
      root,
      u64le(entryFee),
      u64le(perPoint),
      u64le(burnQty),
      blankMint.toBuffer(),
    ]),
  });
  const cfgInfo = await connection.getAccountInfo(configPda());
  if (cfgInfo) {
    console.log('config already initialized, skipping initialize');
  } else {
    const sig1 = await sendAndConfirmTransaction(connection, new Transaction().add(initIx), [authority]);
    console.log('initialized:', sig1);
  }

  // ---- set letter mints ----
  const mints = 'abcdefghijklmnopqrstuvwxyz'
    .split('')
    .map((l) => new PublicKey(letters.mints[l].mint));
  const setMintsIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([await discriminator('set_letter_mints'), Buffer.concat(mints.map((m) => m.toBuffer()))]),
  });
  const sig2 = await sendAndConfirmTransaction(connection, new Transaction().add(setMintsIx), [authority]);
  console.log('letter mints registered:', sig2);

  // ---- fund vault ----
  const sig3 = await connection.requestAirdrop ?? null; // guard for non-airdrop clusters
  void sig3;
  if ((process.env.RPC_URL ?? '').includes('127.0.0.1') || (process.env.RPC_URL ?? '').includes('devnet')) {
    try {
      await connection.requestAirdrop(authority.publicKey, Number(funding) + LAMPORTS_PER_SOL / 10);
    } catch {
      /* devnet may throttle */
    }
  }
  const sig4 = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: vaultPda(),
        lamports: Number(funding),
      }),
    ),
    [authority],
  );
  console.log('vault funded:', sig4);

  const cluster = clusterFromRpc(process.env.RPC_URL ?? 'localnet');
  const deploy = {
    cluster,
    programId: PROGRAM_ID.toBase58(),
    config: configPda().toBase58(),
    board: boardPda().toBase58(),
    vault: vaultPda().toBase58(),
    merkleRoot: rootHexStr,
    economy: {
      entryFeeLamports: entryFee.toString(),
      payoutPerPointLamports: perPoint.toString(),
      burnQuantityPerTile: burnQty.toString(),
    },
  };
  const dest = path.resolve(import.meta.dirname!, '../deployment.json');
  fs.writeFileSync(dest, JSON.stringify(deploy, null, 2));
  console.log(`wrote ${dest}`);
  const pubDest = path.resolve(import.meta.dirname!, '../app/public/deployment.json');
  fs.writeFileSync(pubDest, JSON.stringify(deploy, null, 2));
  const pubCluster = path.resolve(import.meta.dirname!, `../app/public/deployment.${cluster}.json`);
  fs.writeFileSync(pubCluster, JSON.stringify(deploy, null, 2));
  console.log(`wrote ${pubDest} and ${pubCluster}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
