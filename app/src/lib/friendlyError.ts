/**
 * Maps raw wallet/program errors to short, player-friendly messages.
 * Anchor custom errors start at 6000, in declaration order of errors.rs.
 */
const PROGRAM_ERRORS: Record<number, string> = {
  6000: 'Words need between 2 and 15 letters.',
  6001: 'That word runs off the board.',
  6002: 'Place at least one new tile.',
  6003: 'That move is malformed — re-place your tiles and retry.',
  6004: 'The very first word must cross the center star ★.',
  6005: 'New words must connect to tiles already on the board.',
  6006: 'That square is already taken — play on empty cells only.',
  6007: "Your word doesn't match the letters already on the board.",
  6008: 'That word is not in the official dictionary.',
  6009: 'Cross-word mismatch — refresh the board and retry.',
  6010: 'Proof too deep for that move — try a shorter word.',
  6011: 'Letter token mismatch — refresh and retry.',
  6012: "Those letter tokens aren't in your wallet.",
  6013: 'Token account mismatch — refresh and retry.',
  6014: 'Wrong token program — letter tiles are Token-2022.',
  6015: "You don't have enough of that letter token.",
  6016: "The vault can't cover that payout right now — it needs a top-up. Ping the operator.",
  6017: 'Score overflow — rejected.',
};

const KEYWORDS: [RegExp, string][] = [
  [/Treasury cannot cover/i, "The vault can't cover that payout right now — it needs a top-up."],
  [/already occupied|CellOccupied/i, 'That square is already taken.'],
  [/not in dictionary|DictionaryProofFailed/i, 'That word is not in the official dictionary.'],
  [/FirstMoveNotOnCenter/i, 'The first word must cross the center star ★.'],
  [/must connect|NotConnected/i, 'New words must connect to the existing board.'],
  [/InsufficientTokenBalance/i, "You don't have enough of that letter token."],
  [/User rejected|UserDenied/i, 'Transaction rejected in your wallet.'],
  [/blockhash|block height exceeded|timeout/i, 'Network timeout — try again.'],
  [/insufficient lamports|InsufficientFundsForRent/i, 'Not enough SOL for the entry fee + transaction fees.'],
];

export function friendlyError(e: unknown): string {
  const raw = `${(e as Error)?.message ?? ''} ${(e as Error)?.stack ?? ''}`;
  const hex = raw.match(/custom program error: 0x([0-9a-f]+)/i);
  if (hex) {
    const msg = PROGRAM_ERRORS[parseInt(hex[1], 16)];
    if (msg) return msg;
  }
  for (const [re, msg] of KEYWORDS) {
    if (re.test(raw)) return msg;
  }
  const m = (e as Error)?.message;
  return m && m.length < 200 ? m : 'Something went wrong submitting your word — try again.';
}
