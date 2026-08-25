// Treasury Bot — keeps the SOL prize vault topped up.
//
// Funding loop (the "Volume Tax" flywheel):
//   1. HARVEST  pull withheld Token-2022 transfer fees out of player token
//               accounts into the treasury ATA for each letter mint.
//   2. SWAP     sell collected letter tokens for SOL via Jupiter v6.
//   3. DEPOSIT  send the SOL to the game vault PDA.
//
// Env:
//   RPC_URL           default localnet
//   BOT_KEYPAIR       keypair that is the withdraw-withheld-fees authority
//   LETTERS_JSON      path to letters.json from the launch script
//   VAULT_PUBKEY      game vault PDA (from deployment.json)
//   INTERVAL_SECS     sweep interval, default 900
//   MIN_SWAP_TOKENS   minimum balance worth swapping per letter, default 1000
//   DRY_RUN           "1" -> log only, no tx
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
  ComputeBudgetProgram,
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
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  withdrawWithheldTokensFromAccounts,
} from '@solana/spl-token';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const JUP_QUOTE = 'https://quote-api.jup.ag/v6/quote';
const JUP_SWAP = 'https://quote-api.jup.ag/v6/swap';

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(p, 'utf8'))));
}
const ataOf = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
  )[0];

async function jupiterSwapToSol(connection: Connection, bot: Keypair, mint: PublicKey, amountIn: bigint) {
  const qs = new URLSearchParams({
    inputMint: mint.toBase58(),
    outputMint: 'So11111111111111111111111111111111111111112',
    amount: amountIn.toString(),
    slippageBps: '50',
  });
  const quote = (await fetch(`${JUP_QUOTE}?${qs}`).then((r) => r.json())) as { outAmount?: string };
  if (!quote?.outAmount) throw new Error(`no jupiter route for ${mint.toBase58()}`);

  const swapResp = (await fetch(JUP_SWAP, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: bot.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  }).then((r) => r.json())) as { swapTransaction?: string };
  if (!swapResp?.swapTransaction) throw new Error(`jupiter swap build failed for ${mint.toBase58()}`);

  const raw = Buffer.from(swapResp.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(raw);
  tx.sign([bot]);
  return connection.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
}

async function sweepOnce(dryRun: boolean) {
  const connection = new Connection(process.env.RPC_URL ?? 'http://127.0.0.1:8899', 'confirmed');
  const bot = loadKeypair(process.env.BOT_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`);
  const letters = JSON.parse(fs.readFileSync(process.env.LETTERS_JSON ?? path.resolve(import.meta.dirname!, '../../letters.json'), 'utf8'));
  const vault = new PublicKey(
    process.env.VAULT_PUBKEY ??
      JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname!, '../../deployment.json'), 'utf8')).vault,
  );
  const minSwap = BigInt(process.env.MIN_SWAP_TOKENS ?? 1000);

  console.log(`[bot] ${new Date().toISOString()} treasury sweep start (dryRun=${dryRun})`);

  // 1+2. harvest fees & swap per letter
  for (const letter of LETTERS) {
    try {
      const mint = new PublicKey(letters.mints[letter].mint);
      const treasuryAta = ataOf(bot.publicKey, mint);
      let acct;
      try {
        acct = await getAccount(connection, treasuryAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
      } catch {
        continue; // no ATA yet / nothing harvested
      }

      // NOTE: full fee harvesting needs the set of player ATAs; production bots
      // index WordPlayed events + transfer logs to find sources. Here we sweep
      // whatever has already been withdrawn into the treasury ATA.
      const balance = acct.amount;
      if (balance < minSwap) continue;

      if (!dryRun) {
        const sig = await jupiterSwapToSol(connection, bot, mint, balance);
        console.log(`[bot] swapped ${balance} $${letter.toUpperCase()} -> SOL (${sig})`);
      } else {
        console.log(`[bot] DRY_RUN would swap ${balance} $${letter.toUpperCase()}`);
      }
    } catch (e) {
      console.warn(`[bot] $${letter.toUpperCase()} sweep failed:`, (e as Error).message);
    }
  }

  // 3. deposit swept SOL into the game vault (keep 0.05 SOL for gas)
  try {
    const bal = await connection.getBalance(bot.publicKey);
    const gasReserve = 0.05 * LAMPORTS_PER_SOL;
    const depositable = bal - gasReserve - 5000 * 32; // rent headroom
    if (depositable > 0.01 * LAMPORTS_PER_SOL) {
      if (!dryRun) {
        const ix: TransactionInstruction[] = [
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
          SystemProgram.transfer({ fromPubkey: bot.publicKey, toPubkey: vault, lamports: depositable }),
        ];
        const msg = new TransactionMessage({
          payerKey: bot.publicKey,
          recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
          instructions: ix,
        }).compileToV0Message();
        const tx = new VersionedTransaction(msg);
        tx.sign([bot]);
        const sig = await connection.sendRawTransaction(tx.serialize());
        console.log(`[bot] deposited ${(depositable / LAMPORTS_PER_SOL).toFixed(4)} SOL -> vault (${sig})`);
      } else {
        console.log(`[bot] DRY_RUN would deposit ${(depositable / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      }
    }
  } catch (e) {
    console.warn('[bot] deposit failed:', (e as Error).message);
  }
  console.log('[bot] sweep done');
}

async function main() {
  const once = process.argv.includes('--once') || process.env.DRY_RUN === '1';
  const intervalMs = Number(process.env.INTERVAL_SECS ?? 900) * 1000;
  do {
    await sweepOnce(!!process.env.DRY_RUN && process.env.DRY_RUN === '1');
    if (once) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (true);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
