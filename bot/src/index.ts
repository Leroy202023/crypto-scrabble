// Treasury Bot — keeps the SOL prize vault topped up.
//
// Funding loop (the "Volume Tax" flywheel):
//   1. DISCOVER  index WordPlayed events to learn which players have ATAs
//                (their burned tiles withheld a 2% transfer fee).
//   2. HARVEST   pull withheld Token-2022 transfer fees out of every player
//                ATA into each letter mint's withheld-escrow.
//   3. WITHDRAW  move each mint's escrowed fees into the treasury ATA
//                (requires the withdraw-withheld-fees authority = bot key).
//   4. SWAP      sell collected letter tokens for SOL via Jupiter v6 (only when
//                SWAP=1; skipped on localnet where no DEX exists).
//   5. DEPOSIT   send the SOL to the game vault PDA.
//
// Env:
//   RPC_URL            default localnet
//   BOT_KEYPAIR        keypair = withdraw-withheld-fees authority (treasury)
//   LETTERS_JSON       path to letters.json
//   VAULT_PUBKEY       game vault PDA (from deployment.json)
//   TREASURY_PUBKEY    treasury ATA owner (defaults to BOT_KEYPAIR pubkey)
//   INTERVAL_SECS      sweep interval, default 900
//   MIN_WITHDRAW_TOKENS minimum withheld per mint worth withdrawing, default 1000
//   SWAP               "1" -> attempt Jupiter swap (mainnet/devnet only)
//   DRY_RUN            "1" -> log only, no tx
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
  getTransferFeeAmount,
  harvestWithheldTokensToMint,
  withdrawWithheldTokensFromMint,
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const JUP_QUOTE = 'https://quote-api.jup.ag/v6/quote';
const JUP_SWAP = 'https://quote-api.jup.ag/v6/swap';
const KNOWN_PLAYERS_FILE = path.resolve(import.meta.dirname!, '../../.known_players.json');

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(p, 'utf8'))));
}
const ataOf = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
  )[0];

function loadKnownPlayers(): Set<string> {
  try {
    return new Set(JSON.parse(fs.readFileSync(KNOWN_PLAYERS_FILE, 'utf8')));
  } catch {
    return new Set();
  }
}
function saveKnownPlayers(set: Set<string>) {
  fs.writeFileSync(KNOWN_PLAYERS_FILE, JSON.stringify([...set]));
}

function loadIdl() {
  const file = path.resolve(import.meta.dirname!, '../../target/idl/crypto_scrabble.json');
  const idl = JSON.parse(fs.readFileSync(file, 'utf8')) as anchor.Idl;
  for (const a of idl.accounts ?? []) (a as unknown as { size: number }).size = 8192;
  return idl;
}

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
  const treasury = new PublicKey(process.env.TREASURY_PUBKEY ?? bot.publicKey.toBase58());
  const minWithdraw = BigInt(process.env.MIN_WITHDRAW_TOKENS ?? 1000);
  const known = loadKnownPlayers();

  const mints = LETTERS.map((l) => new PublicKey(letters.mints[l].mint));
  const treasuryAtas = mints.map((m) => ataOf(treasury, m));

  console.log(`[bot] ${new Date().toISOString()} sweep start (dryRun=${dryRun}, knownPlayers=${known.size})`);

  // 2-3. harvest withheld fees from player ATAs into mints, then withdraw to treasury
  let totalWithdrawn = 0n;
  for (let mi = 0; mi < mints.length; mi++) {
    const mint = mints[mi];
    const tAta = treasuryAtas[mi];
    const harvestAtas: PublicKey[] = [];
    for (const p of known) {
      const owner = new PublicKey(p);
      const ata = ataOf(owner, mint);
      try {
        const acct = await getAccount(connection, ata, 'confirmed', TOKEN_2022_PROGRAM_ID);
        const fee = getTransferFeeAmount(acct);
        if (fee && fee.withheldAmount > 0n) harvestAtas.push(ata);
      } catch {
        /* no ATA yet */
      }
    }
    if (harvestAtas.length === 0) continue;

    if (!dryRun) {
      // move withheld fees from player ATAs into the mint's escrow
      await harvestWithheldTokensToMint(connection, bot, mint, harvestAtas, undefined, TOKEN_2022_PROGRAM_ID);
      // move the mint's escrow into the treasury ATA
      await withdrawWithheldTokensFromMint(
        connection,
        bot,
        mint,
        tAta,
        bot.publicKey,
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
    } else {
      console.log(`[bot] DRY_RUN would harvest+withdraw ${harvestAtas.length} ATAs for $${LETTERS[mi].toUpperCase()}`);
    }

    // how much landed in the treasury ATA
    try {
      const after = await getAccount(connection, tAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
      totalWithdrawn += after.amount;
    } catch {
      /* treasury ATA not created yet */
    }
  }

  // 4-5. swap to SOL and deposit into the vault (only when enabled)
  const doSwap = process.env.SWAP === '1';
  if (totalWithdrawn > 0n && doSwap) {
    if (!dryRun) {
      for (let mi = 0; mi < mints.length; mi++) {
        const tAta = treasuryAtas[mi];
        try {
          const acct = await getAccount(connection, tAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
          if (acct.amount >= minWithdraw) {
            const sig = await jupiterSwapToSol(connection, bot, mints[mi], acct.amount);
            console.log(`[bot] swapped ${acct.amount} $${LETTERS[mi].toUpperCase()} -> SOL (${sig.slice(0, 12)}…)`);
          }
        } catch (e) {
          console.warn(`[bot] $${LETTERS[mi].toUpperCase()} swap failed:`, (e as Error).message);
        }
      }
    }
  }

  // deposit swept SOL into the game vault (keep 0.05 SOL for gas)
  try {
    const bal = await connection.getBalance(bot.publicKey);
    const gasReserve = 0.05 * LAMPORTS_PER_SOL;
    const depositable = bal - gasReserve - 5000 * 32;
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
        console.log(`[bot] deposited ${(depositable / LAMPORTS_PER_SOL).toFixed(4)} SOL -> vault (${sig.slice(0, 12)}…)`);
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
  const dryRun = process.env.DRY_RUN === '1';
  const once = process.argv.includes('--once') || dryRun;
  const intervalMs = Number(process.env.INTERVAL_SECS ?? 900) * 1000;

  // discover players by listening for WordPlayed events
  const known = loadKnownPlayers();
  try {
    const connection = new Connection(process.env.RPC_URL ?? 'http://127.0.0.1:8899', 'confirmed');
    const bot = loadKeypair(process.env.BOT_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`);
    const wallet = new anchor.Wallet(bot);
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new anchor.Program(loadIdl(), provider);
    program.addEventListener('WordPlayed', (e: { player: PublicKey }) => {
      const k = e.player.toBase58();
      if (!known.has(k)) {
        known.add(k);
        saveKnownPlayers(known);
        console.log(`[bot] discovered player ${k.slice(0, 8)}…`);
      }
    });
  } catch (e) {
    console.warn('[bot] event listener unavailable:', (e as Error).message);
  }

  do {
    await sweepOnce(dryRun);
    if (once) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (true);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
