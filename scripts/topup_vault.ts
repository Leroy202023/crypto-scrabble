// Top up the game payout vault with SOL from the authority wallet.
// Usage:  RPC_URL=... AUTHORITY_KEYPAIR=... AMOUNT_SOL=0.5 npx tsx scripts/topup_vault.ts
import 'dotenv/config';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import fs from 'node:fs';
import { vaultPda } from '../shared/program';

function loadKeypair(p: string): Keypair {
  const expanded = p.replace(/^~(?=$|\/)/, process.env.HOME ?? '');
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(expanded, 'utf8'))));
}

async function main() {
  const conn = new Connection(process.env.RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed');
  const authority = loadKeypair(
    process.env.AUTHORITY_KEYPAIR ?? `${process.env.HOME}/.config/solana/devnet-deploy.json`,
  );
  const amountSol = Number(process.env.AMOUNT_SOL ?? '0.5');

  const before = await conn.getBalance(vaultPda);
  console.log(`[topup] vault ${vaultPda.toBase58()}`);
  console.log(`[topup] balance before: ${(before / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`[topup] sending ${amountSol} SOL from ${authority.publicKey.toBase58()}…`);

  const sig = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: vaultPda,
        lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
      }),
    ),
    [authority],
  );

  const after = await conn.getBalance(vaultPda);
  console.log(`[topup] tx ${sig}`);
  console.log(`[topup] balance after:  ${(after / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
