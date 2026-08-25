use anchor_lang::prelude::*;

use crate::state::*;

#[derive(Accounts)]
pub struct SetLetterMints<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump, has_one = authority)]
    pub config: AccountLoader<'info, GameConfig>,
}

pub fn handler(ctx: Context<SetLetterMints>, mints: [Pubkey; LETTER_COUNT]) -> Result<()> {
    ctx.accounts.config.load_mut()?.letter_mints = mints;
    Ok(())
}
