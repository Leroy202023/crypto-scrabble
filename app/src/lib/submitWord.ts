import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { BOARD, CONFIG, VAULT, getProgramId, connection, letterMints } from './state';

const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/** anchor discriminator = sha256("global:<ix>")[..8] */
import { sha256 } from '@noble/hashes/sha256';
function discriminator(name: string): Buffer {
  return Buffer.from(sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8));
}

const u8 = (n: number) => Buffer.from([n & 0xff]);
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

export type CrossWordProof = {
  leafIndex: number;
  proof: Uint8Array[];
};

export type SubmitParams = {
  player: PublicKey;
  startX: number;
  startY: number;
  direction: 0 | 1;
  letters: Uint8Array; // ascii a..z (full run incl. bridged tiles)
  newMask: boolean[];
  blankMask: boolean[]; // parallel to letters; true = blank (burns blank mint, 0 pts)
  leafIndex: number;
  proof: Uint8Array[];
  crossWords: CrossWordProof[];
};

/**
 * Seralizes the submit_word instruction data (Anchor-compatible). Pure: needs
 * the letter->mint map rather than fetching /letters.json. The exact byte format
 * must match the program's SubmitWordArgs AnchorSerialize so the chain accepts it.
 */
export function encodeSubmitWordData(p: SubmitParams, mints: Record<string, PublicKey>): Buffer {
  const dataParts: Buffer[] = [
    discriminator('submit_word'),
    u8(p.startX),
    u8(p.startY),
    u8(p.direction),
    u32(p.letters.length),
    Buffer.from(p.letters),
    u32(p.newMask.length),
    Buffer.from(p.newMask.map((b) => (b ? 1 : 0))),
    u32(p.blankMask.length),
    Buffer.from(p.blankMask.map((b) => (b ? 1 : 0))),
    u32(p.leafIndex >>> 0),
    u32(p.proof.length),
  ];
  for (const sib of p.proof) dataParts.push(Buffer.from(sib));

  // cross-word proofs (canonical order: matches program detection)
  dataParts.push(u32(p.crossWords.length));
  for (const cw of p.crossWords) {
    dataParts.push(u32(cw.leafIndex >>> 0));
    dataParts.push(u32(cw.proof.length));
    for (const sib of cw.proof) dataParts.push(Buffer.from(sib));
  }
  return Buffer.concat(dataParts);
}

/**
 * Builds the submit_word transaction.
 * Account order matches SubmitWord in the program:
 *   player, config, board, vault, token_program, system_program,
 *   then per NEW tile k in run order: [mint_k, player_ata_k].
 */
export async function buildSubmitWordTx(p: SubmitParams): Promise<VersionedTransaction> {
  const [conn, mints] = await Promise.all([connection(), letterMints()]);

  const data = encodeSubmitWordData(p, mints);

  type Meta = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };
  const keys: Meta[] = [
    { pubkey: p.player, isSigner: true, isWritable: true },
    { pubkey: CONFIG(), isSigner: false, isWritable: true },
    { pubkey: BOARD(), isSigner: false, isWritable: true },
    { pubkey: VAULT(), isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  for (let i = 0; i < p.letters.length; i++) {
    if (!p.newMask[i]) continue;
    const letter = String.fromCharCode(p.letters[i]).toLowerCase();
    // blanks burn the wildcard mint instead of the letter mint
    const mint = p.blankMask[i] && mints['*'] ? mints['*'] : mints[letter];
    if (!mint) throw new Error(`no mint registered for $${letter.toUpperCase()} — run npm run launch:letters`);
    const ata = PublicKey.findProgramAddressSync(
      [p.player.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ATA_PROGRAM,
    )[0];
    keys.push({ pubkey: mint, isSigner: false, isWritable: true });
    keys.push({ pubkey: ata, isSigner: false, isWritable: true });
  }

  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
    new TransactionInstruction({
      programId: getProgramId(),
      keys,
      data,
    }),
  ];

  const msg = new TransactionMessage({
    payerKey: p.player,
    recentBlockhash: (await conn.getLatestBlockhash()).blockhash,
    instructions: ixs,
  }).compileToV0Message();
  return new VersionedTransaction(msg);
}
