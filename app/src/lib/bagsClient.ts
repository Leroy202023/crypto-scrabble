// Client side of Scrabble Bags: collection metadata, buy tx, owned-bag scan,
// open (burn) tx.
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  createBurnInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

const ATA_PROG = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** Operator wallet that receives bag payments and runs the minting bot. */
export const BAGS_TREASURY = new PublicKey('ABiV56njHJViDdgNz4det2doKBoa9iJmAY4sHNM33upF');

export type Tier = 'common' | 'rare' | 'legendary';

export interface CollectionInfo {
  name: string;
  symbol: string;
  count: number;
  pricesLamports: Record<Tier, number>;
  tiers: Record<string, number>;
  bags: { i: number; t: Tier; m: string }[];
}

let cache: CollectionInfo | null = null;
export async function loadCollection(): Promise<CollectionInfo | null> {
  if (cache) return cache;
  try {
    const r = await fetch('/bags/collection.json');
    if (!r.ok) return null;
    cache = (await r.json()) as CollectionInfo;
    return cache;
  } catch {
    return null;
  }
}

export function artFor(index: number): string {
  return `/bags/${index}.png`;
}
export function heroFor(tier: Tier): string {
  return `/bags/hero-${tier}.png`;
}

export function priceSol(c: CollectionInfo, tier: Tier): string {
  return (c.pricesLamports[tier] / LAMPORTS_PER_SOL).toFixed(2);
}

/** Payment tx: SOL to treasury + memo tag the bot parses. */
export function buildBuyTransfer(payer: PublicKey, tier: Tier, priceLamports: number): Transaction {
  const memo = new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM,
    data: Buffer.from(`bags:buy:${tier}`, 'utf8'),
  });
  return new Transaction().add(
    memo,
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: BAGS_TREASURY,
      lamports: priceLamports,
    }),
  );
}

export interface OwnedBag {
  index: number;
  mint: PublicKey;
  tier: Tier;
}

/** All bag NFTs (0-dec, supply-1 mints from the collection) held by owner. */
export async function fetchOwnedBags(
  conn: Connection,
  owner: PublicKey,
  collection: CollectionInfo,
): Promise<OwnedBag[]> {
  const known = new Map(collection.bags.map((b) => [b.m, b]));
  const res = await conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID });
  const out: OwnedBag[] = [];
  for (const { account } of res.value) {
    const parsed = account.data.parsed as {
      info: { mint: string; tokenAmount: { decimals: number; amount: string } };
    };
    const { mint, tokenAmount } = parsed.info;
    const meta = known.get(mint);
    if (meta && tokenAmount.decimals === 0 && tokenAmount.amount === '1') {
      out.push({ index: meta.i, mint: new PublicKey(mint), tier: meta.t });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Burn the bag NFT — the bot watches this and delivers the letters. */
export async function buildOpenTx(owner: PublicKey, bag: OwnedBag): Promise<Transaction> {
  const ata = getAssociatedTokenAddressSync(bag.mint, owner, false, TOKEN_2022_PROGRAM_ID, ATA_PROG);
  return new Transaction().add(
    createBurnInstruction(ata, bag.mint, owner, 1, [], TOKEN_2022_PROGRAM_ID),
  );
}
