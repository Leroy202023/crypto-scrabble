import 'dotenv/config';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import fs from 'node:fs';
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const T = 'ABiV56njHJViDdgNz4det2doKBoa9iJmAY4sHNM33upF';
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/player.json', 'utf8'))));
const tier = process.argv[2] ?? 'rare';
const price = tier === 'legendary' ? 0.3 : tier === 'rare' ? 0.12 : 0.05;
const tx = new Transaction().add(
  new TransactionInstruction({ keys: [], programId: MEMO, data: Buffer.from(`bags:buy:${tier}`) }),
  SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: new PublicKey(T), lamports: price * LAMPORTS_PER_SOL }),
);
async function main(){
  const sig = await sendAndConfirmTransaction(conn, tx, [payer]);
  console.log('BUY_OK', tier, sig);
}
main();
