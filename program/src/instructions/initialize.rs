use anchor_lang::prelude::*;

use crate::state::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = GameConfig::SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: AccountLoader<'info, GameConfig>,

    #[account(
        init,
        payer = authority,
        space = GameBoard::SPACE,
        seeds = [BOARD_SEED],
        bump
    )]
    pub board: AccountLoader<'info, GameBoard>,

    /// CHECK: PDA vault that custody's SOL payouts. Seeds verified here.
    #[account(seeds = [VAULT_SEED], bump)]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Initialize>,
    merkle_root: [u8; 32],
    entry_fee_lamports: u64,
    payout_per_point_lamports: u64,
    burn_quantity_per_tile: u64,
) -> Result<()> {
    // `init` creates both accounts with fully zeroed data, so counter/cells/
    // letter_mints defaults come for free — only write the non-zero fields.
    let config = &mut ctx.accounts.config.load_init()?;
    config.authority = ctx.accounts.authority.key();
    config.merkle_root = merkle_root;
    config.entry_fee_lamports = entry_fee_lamports;
    config.payout_per_point_lamports = payout_per_point_lamports;
    config.burn_quantity_per_tile = burn_quantity_per_tile;
    config.vault_bump = ctx.bumps.vault;

    emit!(GameInitialized {
        authority: config.authority,
        entry_fee_lamports,
        payout_per_point_lamports,
    });
    Ok(())
}
