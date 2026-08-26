// Devnet SOL faucet farmer + consolidator (DEVNET TEST TOKENS ONLY — no value).
//
// Strategy: generate up to N ephemeral wallets, hammer the devnet faucet for
// each until it rate-limits, then sweep everything into your MAIN wallet.
// The per-wallet faucet cap is what 10 wallets multiply; the IP may still be
// throttled, so this retries with backoff.
//
//   MAIN_WALLET=<pubkey> tsx scripts/farm_devnet.ts [numWallets=10] [attempts=40]
//
import fs from 'node:fs';
import path from 'node:path';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const DEVNET = 'https://api.devnet.solana.com';
const WALLETS_FILE = path.resolve(import.meta.dirname!, '../.devnet_wallets.json');
const FEE_RESERVE = 6000; // lamports kept per wallet for the sweep tx fee

function loadMain(): PublicKey {
  const m = process.env.MAIN_WALLET;
  if (!m) throw new Error('set MAIN_WALLET=<base58 pubkey>');
  return new PublicKey(m);
}

function loadOrCreateWallets(n: number): Keypair[] {
  let arr: { secretKey: number[] }[] = [];
  if (fs.existsSync(WALLETS_FILE)) {
    arr = JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));
  }
  while (arr.length < n) {
    const kp = Keypair.generate();
    arr.push({ secretKey: [...kp.secretKey] });
  }
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(arr));
  return arr.map((a) => Keypair.fromSecretKey(Uint8Array.from(a.secretKey)));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function farmOne(conn: Connection, kp: Keypair, maxAttempts: number) {
  const isnon = (e: unknown) => {
    const s = String(e).toLowerCase();
    return /rate limit|429|too many requests|exceeded|throttl/.test(s);
  };
  let got = 0;
  let backoff = 4000;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const sig = await conn.requestAirdrop(kp.publicKey, 1 * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, 'confirmed').catch(() => {});
      got += 1;
      backoff = 4000;
    } catch (e) {
      if (!isnon(e)) {
        console.log(`   unexpected: ${String(e).slice(0, 80)}`);
      }
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 120_000);
    }
  }
  return got;
}

async function main() {
  const num = Number(process.argv[2] ?? 10);
  const attempts = Number(process.argv[3] ?? 40);
  const main = loadMain();
  const conn = new Connection(DEVNET, 'confirmed');
  const wallets = loadOrCreateWallets(num);

  console.log(`farming ${wallets.length} wallets -> main ${main.toBase58()}`);
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const before = await conn.getBalance(w.publicKey).catch(() => 0);
    const n = await farmOne(conn, w, attempts);
    const after = await conn.getBalance(w.publicKey).catch(() => 0);
    console.log(`wallet ${i} ${w.publicKey.toBase58()}: +${n} drops, ${after / LAMPORTS_PER_SOL} SOL`);
    void before;
  }

  // sweep to main
  console.log('sweeping to main...');
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const bal = await conn.getBalance(w.publicKey).catch(() => 0);
    const send = bal - FEE_RESERVE;
    if (send <= 0) continue;
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: w.publicKey, toPubkey: main, lamports: send }),
      );
      const sig = await sendAndConfirmTransaction(conn, tx, [w], { commitment: 'confirmed' });
      console.log(`wallet ${i} -> main ${send / LAMPORTS_PER_SOL} SOL (${sig.slice(0, 12)}…)`);
    } catch (e) {
      console.log(`wallet ${i} sweep failed: ${String(e).slice(0, 80)}`);
    }
  }
  const mainBal = await conn.getBalance(main).catch(() => 0);
  console.log(`main wallet total: ${mainBal / LAMPORTS_PER_SOL} SOL (devnet)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
