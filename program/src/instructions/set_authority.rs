use anchor_lang::prelude::*;

use crate::state::*;

#[derive(Accounts)]
pub struct SetAuthority<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump, has_one = authority)]
    pub config: AccountLoader<'info, GameConfig>,
}

pub fn handler(ctx: Context<SetAuthority>, new_authority: Pubkey) -> Result<()> {
    ctx.accounts.config.load_mut()?.authority = new_authority;
    Ok(())
}
