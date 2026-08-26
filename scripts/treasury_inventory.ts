// Reports the treasury's actual letter-token inventory (tiles playable at
// 1 tile = burn_quantity units) — i.e. how many bags/packs can be backed.
// Usage: RPC_URL=... npx tsx scripts/treasury_inventory.ts
import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROG = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const BURN_QTY = Number(process.env.BURN_QTY ?? 1000);

async function main() {
  const conn = new Connection(
    process.env.RPC_URL ?? 'https://api.devnet.solana.com',
    'confirmed',
  );
  const owner = new PublicKey(
    process.env.AUTHORITY ?? 'ABiV56njHJViDdgNz4det2doKBoa9iJmAY4sHNM33upF',
  );
  const letters = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname!, '../letters.json'), 'utf8'),
  );

  let totUnits = 0;
  for (const [k, entry] of Object.entries(letters.mints as Record<string, { mint: string }>)) {
    const ata = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_2022.toBuffer(), new PublicKey(entry.mint).toBuffer()],
      ATA_PROG,
    )[0];
    try {
      const acct = await getAccount(conn, ata, 'confirmed', TOKEN_2022);
      const amt = Number(acct.amount);
      totUnits += amt;
      console.log(`${k === '*' ? 'blank' : k}: ${amt.toLocaleString()} u (${Math.floor(amt / BURN_QTY).toLocaleString()} tiles)`);
    } catch {
      console.log(`${k === '*' ? 'blank' : k}: no ATA`);
    }
  }
  console.log(`\nTREASURY: ${totUnits.toLocaleString()} units = ${Math.floor(totUnits / BURN_QTY).toLocaleString()} tiles playable`);
}

main();
