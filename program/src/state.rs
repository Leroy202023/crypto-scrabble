use anchor_lang::prelude::*;

pub const BOARD_SIZE: usize = 15;
pub const TOTAL_CELLS: usize = BOARD_SIZE * BOARD_SIZE;
pub const CENTER_INDEX: usize = (BOARD_SIZE / 2) * BOARD_SIZE + (BOARD_SIZE / 2);
pub const MAX_WORD_LEN: usize = BOARD_SIZE;
pub const LETTER_COUNT: usize = 26;
pub const MAX_PROOF_LEN: usize = 24;

pub const CONFIG_SEED: &[u8] = b"config";
pub const BOARD_SEED: &[u8] = b"board";
pub const VAULT_SEED: &[u8] = b"vault";

/// Standard Scrabble tile values, indexed `letter - b'a'`.
pub const LETTER_VALUES: [u64; LETTER_COUNT] = [
    1, 3, 3, 2, 1, // a-e
    4, 2, 4, 1, 8, // f-j
    5, 1, 3, 1, 1, // k-o
    3, 10, 1, 1, 1, // p-t
    1, 4, 4, 8, 4, 10, // u-z
];

/// Zero-copy so the ~1 KB config never lands on the SBF stack (4 KB frame limit).
#[account(zero_copy)]
pub struct GameConfig {
    pub authority: Pubkey,
    /// SHA-256 merkle root over every dictionary word leaf.
    pub merkle_root: [u8; 32],
    pub entry_fee_lamports: u64,
    pub payout_per_point_lamports: u64,
    pub burn_quantity_per_tile: u64,
    pub total_words_played: u64,
    pub total_payout_lamports: u64,
    pub total_burned_units: u64,
    /// `letter_mints[letter - 'a']` — Token-2022 mint for each letter.
    pub letter_mints: [Pubkey; LETTER_COUNT],
    /// Token-2022 mint burned when a BLANK tile is placed.
    pub blank_mint: Pubkey,
    pub vault_bump: u8,
    /// Tail padding for bytemuck `Pod` (total size must be 8-aligned).
    pub _pad: [u8; 7],
}

impl GameConfig {
    pub const SPACE: usize = 8
        + 32              // authority
        + 32              // merkle_root
        + 8 * 6           // numeric fields
        + 32 * LETTER_COUNT // letter_mints
        + 32              // blank_mint
        + 1               // vault_bump
        + 128;            // headroom for Anchor reallocation safety
}

#[zero_copy]
#[repr(C)]
pub struct Cell {
    /// 0/1 (`u8`, because `bool` is not `Pod`); 1 = tile placed.
    pub occupied: u8,
    pub letter: u8, // ascii lowercase a..z when occupied
    /// 0/1; 1 = this tile is a blank (scores 0 points, forever).
    pub blank: u8,
    pub player: Pubkey,
}

/// Zero-copy: deref'ing this account works directly on account memory instead
/// of deserializing ~8.6 KB onto the SBF stack.
#[account(zero_copy)]
pub struct GameBoard {
    pub words_played: u64,
    pub cells: [Cell; TOTAL_CELLS],
    /// Tail padding for bytemuck `Pod` (total size must be 8-aligned).
    pub _pad: [u8; 5],
}


impl GameBoard {
    pub const SPACE: usize =
        8 + 8 + (TOTAL_CELLS * (1 + 1 + 1 + 32)) + 16; // discriminator + counter + cells + headroom

    #[inline]
    pub fn idx(x: usize, y: usize) -> usize {
        y * BOARD_SIZE + x
    }
}

#[event]
pub struct WordPlayed {
    pub player: Pubkey,
    pub word: String,
    /// Scrabble points of the main word only (pre-cross total).
    pub main_score_points: u64,
    /// Total points paid out = main + all perpendicular cross words.
    pub score_points: u64,
    /// Every perpendicular cross word formed this turn (client canonical order).
    pub cross_words: Vec<String>,
    pub payout_lamports: u64,
    pub entry_fee_lamports: u64,
    pub burned_units: u64,
    pub tiles_placed: u8,
}

#[event]
pub struct GameInitialized {
    pub authority: Pubkey,
    pub entry_fee_lamports: u64,
    pub payout_per_point_lamports: u64,
}
