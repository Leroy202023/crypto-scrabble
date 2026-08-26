// Scrabble Bags bot — the trust-lite pack machine.
//
//   BUY:   player sends SOL to the bot treasury with memo "bags:buy:<tier>"
//          → bot mints the next unassigned bag NFT (1-supply SPL, 0 decimals)
//            straight to the buyer's wallet.
//   OPEN:  player burns their bag NFT (client "Open" button)
//          → bot detects the emptied ATA and delivers the letter-token bundle
//            from treasury ATAs (contents from reveals.json).
//
// Fairness: contents were committed upfront (data/bags/sealed.json); the
// reveal for a sold bag is published on open so anyone can verify.
//
// Env:
//   RPC_URL         default devnet
//   BOT_KEYPAIR     treasury/authority keypair (default devnet-deploy.json)
//   POLL_SECS       default 15
//   DRY_RUN         "1" -> log actions, send nothing
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createBurnInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMintLen,
} from '@solana/spl-token';
import bs58 from 'bs58';

const ROOT = path.resolve(import.meta.dirname!, '..', '..');
const BAGS = path.join(ROOT, 'data', 'bags');
const ATA_PROG = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const MEMO_PREFIX = 'bags:buy:';

function loadKeypair(p: string): Keypair {
  const expanded = p.replace(/^~(?=$|\/)/, process.env.HOME ?? '');
  return Keypair.fromSecretKey(
    p.endsWith('.json')
      ? new Uint8Array(JSON.parse(fs.readFileSync(expanded, 'utf8')))
      : bs58.decode(fs.readFileSync(expanded, 'utf8').trim()),
  );
}

function loadJson<T>(p: string, fallback: T): T {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback;
}
function saveJson(p: string, v: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

interface LedgerEntry { owner: string; tier: string; mint: string; delivered?: boolean }
type Ledger = Record<string, LedgerEntry>; // bag index (string) -> entry

async function main() {
  const conn = new Connection(process.env.RPC_URL ?? 'https://api.devnet.solana.com', {
    commitment: 'confirmed',
    fetchMiddleware: (url, options, fetch) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      options.signal = ctrl.signal;
      fetch(url, options).finally(() => clearTimeout(timer));
    },
  });
  const bot = loadKeypair(process.env.BOT_KEYPAIR ?? `${process.env.HOME}/.config/solana/devnet-deploy.json`);
  const dry = process.env.DRY_RUN === '1';
  const pollMs = Number(process.env.POLL_SECS ?? 15) * 1000;

  const sealed = loadJson<{ index: number; tier: string; mint: string }[]>(path.join(BAGS, 'sealed.json'), []);
  const reveals = loadJson<{ index: number; contents: Record<string, number> }[]>(path.join(BAGS, 'reveals.json'), []);
  const mintKeys = loadJson<string[]>(path.join(BAGS, 'mints.json'), []);
  const collection = loadJson<{ pricesLamports: Record<string, number> }>(
    path.join(ROOT, 'app', 'public', 'bags', 'collection.json'),
    { pricesLamports: { common: 50_000_000, rare: 120_000_000, legendary: 300_000_000 } },
  );
  const letters = loadJson<{ mints: Record<string, { mint: string }> }>(
    path.join(ROOT, 'letters.json'), { mints: {} },
  );
  const letterMint = Object.fromEntries(Object.entries(letters.mints).map(([k, v]) => [k, new PublicKey(v.mint)]));

  const ledgerPath = path.join(BAGS, 'ledger.json');
  const cursorPath = path.join(BAGS, '.sigs.json');
  const ledger: Ledger = loadJson(ledgerPath, {});
  let cursor: string | undefined = loadJson<string | null>(cursorPath, null) ?? undefined;

  const saveLedger = () => { saveJson(ledgerPath, ledger); saveJson(cursorPath, cursor ?? null); };
  const ataOf = (owner: PublicKey, mint: PublicKey) =>
    getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID, ATA_PROG);

  console.log(`[bags] bot ${bot.publicKey.toBase58()} · ${sealed.length} bags · dry=${dry}`);

  async function mintBag(index: number, buyer: PublicKey) {
    const entry = ledger[String(index)];
    const mint = new PublicKey(sealed[index].mint);
    const mintKp = Keypair.fromSecretKey(bs58.decode(mintKeys[index]));
    const ata = ataOf(buyer, mint);
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: bot.publicKey,
        newAccountPubkey: mint,
        space: getMintLen([]),
        lamports: await conn.getMinimumBalanceForRentExemption(getMintLen([])),
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMintInstruction(mint, 0, bot.publicKey, null, TOKEN_2022_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(bot.publicKey, ata, buyer, mint, TOKEN_2022_PROGRAM_ID, ATA_PROG),
      createMintToInstruction(mint, ata, bot.publicKey, 1, [], TOKEN_2022_PROGRAM_ID),
    );
    const sig = await sendAndConfirmTransaction(conn, tx, [bot, mintKp]);
    entry.mint = mint.toBase58();
    console.log(`[bags] minted bag #${index} (${entry.tier}) -> ${buyer.toBase58()} tx ${sig}`);
  }


function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
  async function deliverContents(index: number) {
    const entry = ledger[String(index)];
    const contents = reveals[index].contents;
    const buyer = new PublicKey(entry.owner);
    const tx = new Transaction();
    const decimals = loadJson<Record<string, number>>(
      path.join(BAGS, 'decimals.json'), {},
    );
    for (const [letter, units] of Object.entries(contents)) {
      const mint = letterMint[letter];
      if (!mint) throw new Error(`no mint for letter ${letter}`);
      const src = ataOf(bot.publicKey, mint);
      const dst = ataOf(buyer, mint);
      if (!(await conn.getAccountInfo(dst))) {
        tx.add(createAssociatedTokenAccountInstruction(bot.publicKey, dst, buyer, mint, TOKEN_2022_PROGRAM_ID, ATA_PROG));
      }
      // Token-2022 mints with a transfer-fee extension require transfer_checked
      tx.add(createTransferCheckedInstruction(src, mint, dst, bot.publicKey, units, decimals[letter] ?? 0, [], TOKEN_2022_PROGRAM_ID));
    }
    const sig = await sendAndConfirmTransaction(conn, tx, [bot]);
    entry.delivered = true;
    console.log(`[bags] delivered bag #${index} (${Object.keys(contents).join('')}) -> ${buyer.toBase58()} tx ${sig}`);
  }

  function extractMemo(tx: NonNullable<Awaited<ReturnType<Connection['getParsedTransaction']>>>): string {
    for (const ix of tx.transaction.message.instructions) {
      const any = ix as unknown as { parsed?: string | { memo?: string }; programId?: PublicKey; data?: string };
      if (typeof any.parsed === 'string') return any.parsed;
      if (any.parsed?.memo) return any.parsed.memo;
      if (any.programId?.equals?.(MEMO_PROGRAM) && any.data) {
        try { return Buffer.from(bs58.decode(any.data)).toString('utf8'); } catch { return any.data; }
      }
    }
    return '';
  }

  async function pollPayments() {
    const sigs = await conn.getSignaturesForAddress(bot.publicKey, { until: cursor, limit: 10 });
    for (const s of sigs.reverse()) {
      if (s.err) { cursor = s.signature; continue; }
      const tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
      cursor = s.signature;
      if (!tx?.meta || !tx.transaction) continue;

      const ixBuyer = tx.transaction.message.accountKeys[0];
      const memo = extractMemo(tx);
      if (!memo.startsWith(MEMO_PREFIX)) continue;
      const tier = memo.slice(MEMO_PREFIX.length).trim();
      const price = collection.pricesLamports[tier];
      if (price == null) { console.log(`[bags] unknown tier in memo: ${memo}`); continue; }

      // SOL received by the bot in this tx
      const idx = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey.equals(bot.publicKey));
      const received = (tx.meta.postBalances[idx] ?? 0) - (tx.meta.preBalances[idx] ?? 0);
      if (received + 5000 < price) { console.log(`[bags] underpaid (${received} < ${price}) — ignored`); continue; }

      const next = sealed.find((b) => b.tier === tier && !ledger[String(b.index)]);
      if (!next) { console.log(`[bags] sold out for tier ${tier}`); continue; }
      console.log(`[bags] payment ${s.signature} · ${received / LAMPORTS_PER_SOL} SOL · ${tier} -> bag #${next.index}`);
      ledger[String(next.index)] = { owner: ixBuyer.pubkey.toBase58(), tier };
      saveLedger();
      if (!dry) await mintBag(next.index, ixBuyer.pubkey);
      saveLedger();
    }
  }

  async function pollOpens() {
    for (const [idx, entry] of Object.entries(ledger)) {
      if (entry.delivered || !entry.mint) continue;
      const ata = ataOf(new PublicKey(entry.owner), new PublicKey(entry.mint));
      try {
        const acct = await getAccount(conn, ata, 'confirmed', TOKEN_2022_PROGRAM_ID);
        if (Number(acct.amount) === 0) {
          console.log(`[bags] burn detected on bag #${idx}`);
          if (!dry) await deliverContents(Number(idx));
          else entry.delivered = true;
          saveLedger();
        }
      } catch {
        /* ATA closed or never existed -> treat as opened */
        console.log(`[bags] bag #${idx} ATA gone — delivering`);
        if (!dry) await deliverContents(Number(idx));
        else entry.delivered = true;
        saveLedger();
      }
    }
  }

  for (;;) {
    try {
      console.log('[bags] tick');
      await pollPayments();
      await pollOpens();
    } catch (e) {
      const msg = (e as Error).message ?? '';
      const throttled = /429|Too Many/i.test(msg);
      console.error(`[bags] loop error: ${msg.slice(0, 90)} — ${throttled ? 'backing off 30s' : 'retrying'}`);
      await new Promise((r) => setTimeout(r, throttled ? 30_000 : pollMs));
      continue;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
