// Patch the anchor JSON IDL so the bytemuck `#[account(zero_copy)]` structs
// expose a borsh `type` layout. Their fields are all fixed-size (u8/u64/pubkey/
// fixed arrays), so the borsh and bytemuck byte layouts are identical — this
// lets the JS coder size and decode them (anchor 0.32 omits this for bytemuck
// accounts, which otherwise crashes `new Program()`). Run AFTER `anchor build`.
import fs from 'node:fs';
import path from 'node:path';

const idlPath = path.resolve(process.argv[2] ?? 'target/idl/crypto_scrabble.json');
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

const cellType = { defined: { name: 'Cell' } };
const structs = {
  GameConfig: {
    kind: 'struct',
    fields: [
      { name: 'authority', type: 'pubkey' },
      { name: 'merkle_root', type: { array: ['u8', 32] } },
      { name: 'entry_fee_lamports', type: 'u64' },
      { name: 'payout_per_point_lamports', type: 'u64' },
      { name: 'burn_quantity_per_tile', type: 'u64' },
      { name: 'total_words_played', type: 'u64' },
      { name: 'total_payout_lamports', type: 'u64' },
      { name: 'total_burned_units', type: 'u64' },
      { name: 'letter_mints', type: { array: ['pubkey', 26] } },
      { name: 'blank_mint', type: 'pubkey' },
      { name: 'vault_bump', type: 'u8' },
      { name: '_pad', type: { array: ['u8', 7] } },
    ],
  },
  GameBoard: {
    kind: 'struct',
    fields: [
      { name: 'words_played', type: 'u64' },
      { name: 'cells', type: { array: [cellType, 225] } },
      { name: '_pad', type: { array: ['u8', 5] } },
    ],
  },
};

let patched = 0;
for (const acc of idl.accounts ?? []) {
  if (structs[acc.name]) {
    acc.type = structs[acc.name];
    // ensure the coder treats it as borsh-decoded (layouts are identical)
    delete acc.serialization;
    patched++;
  }
}
fs.writeFileSync(idlPath, JSON.stringify(idl, null, 2));
console.log(`patched ${patched} account type layouts in ${idlPath}`);
