// Dev helper — mint letter tokens to a player so they can test the game.
//   tsx dev_airdrop.ts <PLAYER_PUBKEY> cat=1000 quiz=50 ...
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from '@solana/spl-token';

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(p, 'utf8'))));
}

async function main() {
  const [playerArg, ...specs] = process.argv.slice(2);
  if (!playerArg || specs.length === 0) throw new Error('usage: dev_airdrop.ts <PLAYER> letter=qty ...');
  const player = new PublicKey(playerArg);
  const connection = new Connection(process.env.RPC_URL ?? 'http://127.0.0.1:8899', 'confirmed');
  const authority = loadKeypair(process.env.AUTHORITY_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`);
  const letters = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname!, '../letters.json'), 'utf8'));

  for (const spec of specs) {
    const [letter, qtyStr] = spec.split('=');
    const qty = BigInt(qtyStr);
    if (!/^[a-z]$/.test(letter)) throw new Error(`bad letter ${letter}`);
    const mint = new PublicKey(letters.mints[letter].mint);

    const ata = PublicKey.findProgramAddressSync(
      [player.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
    )[0];
    const info = await connection.getAccountInfo(ata);
    const tx = new Transaction();
    if (!info) {
      tx.add(
        createAssociatedTokenAccountInstruction(authority.publicKey, ata, player, mint, TOKEN_2022_PROGRAM_ID),
      );
    }
    tx.add(createMintToInstruction(mint, ata, authority.publicKey, qty, [], TOKEN_2022_PROGRAM_ID));
    await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log(`minted ${qty} $${letter.toUpperCase()} -> ${ata.toBase58()}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
