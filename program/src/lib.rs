pub mod errors;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

// Anchor's #[program] macro references `crate::__client_accounts_*` modules,
// which only land at the crate root via a glob re-export.
pub use instructions::*;
pub use state::*;

declare_id!("53h7akfbCsPwDPQax7ANViJp7gSs9BGn4bY4p9zFkrUT");

#[program]
pub mod crypto_scrabble {
    use super::*;

    /// One-time game setup: config + shared board + SOL vault PDA.
    pub fn initialize(
        ctx: Context<Initialize>,
        merkle_root: [u8; 32],
        entry_fee_lamports: u64,
        payout_per_point_lamports: u64,
        burn_quantity_per_tile: u64,
    ) -> Result<()> {
        instructions::initialize::handler(
            ctx,
            merkle_root,
            entry_fee_lamports,
            payout_per_point_lamports,
            burn_quantity_per_tile,
        )
    }

    /// Register / replace the 26 Token-2022 letter mints (authority only).
    pub fn set_letter_mints(
        ctx: Context<SetLetterMints>,
        mints: [Pubkey; LETTER_COUNT],
    ) -> Result<()> {
        instructions::set_letter_mints::handler(ctx, mints)
    }

    /// Play a word: validate placement, verify dictionary proof, burn letter
    /// tokens, collect the entry fee, and pay out from the SOL vault.
    pub fn submit_word<'info>(
        ctx: Context<'_, '_, '_, 'info, SubmitWord<'info>>,
        args: SubmitWordArgs,
    ) -> Result<()> {
        instructions::submit_word::handler(ctx, args)
    }

    /// Rotate authority (authority only).
    pub fn set_authority(ctx: Context<SetAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::set_authority::handler(ctx, new_authority)
    }
}
