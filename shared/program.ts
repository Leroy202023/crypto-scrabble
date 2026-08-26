import { PublicKey } from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey(
  'AJVQGSNjciPGhotWNtoRSocWEVWGtFQNqkSVzmgiYMtx',
);

export const CONFIG_SEED = Buffer.from('config');
export const BOARD_SEED = Buffer.from('board');
export const VAULT_SEED = Buffer.from('vault');

export function configPda(programId: PublicKey = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId)[0];
}
export function boardPda(programId: PublicKey = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([BOARD_SEED], programId)[0];
}
export function vaultPda(programId: PublicKey = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([VAULT_SEED], programId)[0];
}

export const BOARD_SIZE = 15;
export const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;

/** Standard Scrabble letter values, a..z. */
export const LETTER_VALUES: number[] = [
  1, 3, 3, 2, 1, 4, 2, 4, 1, 8, 5, 1, 3, 1, 1, 3, 10, 1, 1, 1, 1, 4, 4, 8, 4, 10,
];

export function scoreWord(word: string): number {
  return [...word.toLowerCase()]
    .filter((c) => c >= 'a' && c <= 'z')
    .reduce((s, c) => s + LETTER_VALUES[c.charCodeAt(0) - 97], 0);
}

/** Like scoreWord, but positions marked blank (parallel `blanks`) score 0. */
export function scoreWordWithBlanks(word: string, blanks?: boolean[]): number {
  const chars = [...word.toLowerCase()].filter((c) => c >= 'a' && c <= 'z');
  return chars.reduce((s, c, i) => s + (blanks?.[i] ? 0 : LETTER_VALUES[c.charCodeAt(0) - 97]), 0);
}
