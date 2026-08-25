use anchor_lang::prelude::*;
use anchor_spl::token_2022;
use anchor_spl::token_interface::{burn, Burn, TokenInterface};

use crate::errors::CryptoScrabbleError;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SubmitWordArgs {
    /// x (column) of the FIRST cell of the contiguous run.
    pub start_x: u8,
    /// y (row) of the FIRST cell of the contiguous run.
    pub start_y: u8,
    /// 0 = horizontal, 1 = vertical.
    pub direction: u8,
    /// Every letter of the contiguous run being formed, in order,
    /// INCLUDING letters already on the board (a-z ascii).
    pub letters: Vec<u8>,
    /// true where the corresponding position is a newly placed tile.
    pub new_mask: Vec<bool>,
    /// Index of this word's leaf in the dictionary merkle tree.
    pub leaf_index: u32,
    /// Sibling hashes, nearest-first.
    pub proof: Vec<[u8; 32]>,
}

#[derive(Accounts)]
pub struct SubmitWord<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: AccountLoader<'info, GameConfig>,

    #[account(mut, seeds = [BOARD_SEED], bump)]
    pub board: AccountLoader<'info, GameBoard>,

    /// CHECK: PDA vault; seeds verified against stored bump in config.
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,

    // remaining_accounts: for each NEW tile i (in run order):
    //   [ letter_mint_i (readonly, Token-2022), player_letter_ata_i (mut) ]
}

/// Token-2022 account layout used for manual checks on remaining accounts.
mod tlayout {
    pub const ATA_MINT_OFF: usize = 0;
    pub const ATA_OWNER_OFF: usize = 32;
    pub const ATA_AMOUNT_OFF: usize = 64;
    pub const ATA_DATA_LEN: usize = 165;
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, SubmitWord<'info>>,
    args: SubmitWordArgs,
) -> Result<()> {
    // Zero-copy loads: both accounts stay in account memory, off the SBF stack.
    let mut cfg = ctx.accounts.config.load_mut()?;
    let mut board_ref = ctx.accounts.board.load_mut()?;
    let board = &mut *board_ref;

    // ---------- structural validation ----------
    let n = args.letters.len();
    if n < 2 || n > MAX_WORD_LEN {
        return err!(CryptoScrabbleError::InvalidWordLength);
    }
    if args.new_mask.len() != n {
        return err!(CryptoScrabbleError::LengthMismatch);
    }
    if args.direction > 1 {
        return err!(CryptoScrabbleError::OutOfBounds);
    }
    if !args.letters.iter().all(|c| (b'a'..=b'z').contains(c)) {
        return err!(CryptoScrabbleError::InvalidLetterBytes);
    }
    let new_positions: Vec<usize> = (0..n).filter(|i| args.new_mask[*i]).collect();
    if new_positions.is_empty() {
        return err!(CryptoScrabbleError::NoNewTiles);
    }
    if ctx.remaining_accounts.len() != new_positions.len() * 2 {
        return err!(CryptoScrabbleError::LengthMismatch);
    }
    if args.proof.len() > MAX_PROOF_LEN {
        return err!(CryptoScrabbleError::ProofTooLong);
    }

    let dx: isize = if args.direction == 0 { 1 } else { 0 };
    let dy: isize = if args.direction == 1 { 1 } else { 0 };
    let sx: isize = args.start_x as isize;
    let sy: isize = args.start_y as isize;

    // bounds
    if sx < 0 || sy < 0 || sx >= BOARD_SIZE as isize || sy >= BOARD_SIZE as isize {
        return err!(CryptoScrabbleError::OutOfBounds);
    }
    let end_x = sx + dx * (n as isize - 1);
    let end_y = sy + dy * (n as isize - 1);
    if end_x >= BOARD_SIZE as isize || end_y >= BOARD_SIZE as isize {
        return err!(CryptoScrabbleError::OutOfBounds);
    }

    // cell-level checks
    let mut had_existing_in_run = false;
    for (i, ch) in args.letters.iter().enumerate() {
        let cx = (sx + dx * i as isize) as usize;
        let cy = (sy + dy * i as isize) as usize;
        let cell = board.cells[GameBoard::idx(cx, cy)];
        if args.new_mask[i] {
            if cell.occupied != 0 {
                return err!(CryptoScrabbleError::CellOccupied);
            }
        } else {
            if cell.occupied == 0 || cell.letter != *ch {
                return err!(CryptoScrabbleError::ExistingLetterMismatch);
            }
            had_existing_in_run = true;
        }
    }

    // connectivity / first-move rules
    if board.words_played == 0 {
        // the very first word must cover the center square
        let mut on_center = false;
        for i in 0..n {
            let cx = (sx + dx * i as isize) as usize;
            let cy = (sy + dy * i as isize) as usize;
            if GameBoard::idx(cx, cy) == CENTER_INDEX {
                on_center = true;
            }
        }
        require!(on_center, CryptoScrabbleError::FirstMoveNotOnCenter);
    } else if !had_existing_in_run {
        // at least one NEW tile must touch an occupied cell outside this run
        let mut connected = false;
        for &i in &new_positions {
            let cx = (sx + dx * i as isize) as isize;
            let cy = (sy + dy * i as isize) as isize;
            let neighbors = [
                (cx.checked_add(1), Some(cy)),
                (
                    cx.checked_sub(1),
                    Some(cy),
                ),
                (Some(cx), cy.checked_add(1)),
                (Some(cx), cy.checked_sub(1)),
            ];
            for (nx, ny) in neighbors {
                let (nx, ny) = match (nx, ny) {
                    (Some(a), Some(b)) => (a, b),
                    _ => continue,
                };
                if nx >= BOARD_SIZE as isize || ny >= BOARD_SIZE as isize {
                    continue;
                }
                let idx = GameBoard::idx(nx as usize, ny as usize);
                let in_run = (dx == 1 && ny == cy && nx >= sx && nx <= end_x)
                    || (dy == 1 && nx == cx && ny >= sy && ny <= end_y);
                if in_run {
                    continue;
                }
                if board.cells[idx].occupied != 0 {
                    connected = true;
                }
            }
        }
        require!(connected, CryptoScrabbleError::NotConnected);
    }

    // ---------- dictionary verification ----------
    let word_bytes = args.letters.clone();
    verify_merkle_proof(cfg.merkle_root, &word_bytes, args.leaf_index, &args.proof)?;

    // ---------- burns ----------
    let burn_qty = cfg.burn_quantity_per_tile;
    let player_info = ctx.accounts.player.to_account_info();
    let token_prog_info = ctx.accounts.token_program.to_account_info();
    let mut burned_units: u64 = 0;
    for (k, &i) in new_positions.iter().enumerate() {
        let letter_idx = (args.letters[i] - b'a') as usize;
        let mint_ai = ctx.remaining_accounts[k * 2].to_account_info();
        let ata_ai = ctx.remaining_accounts[k * 2 + 1].to_account_info();

        // program identity checks
        if *mint_ai.owner != token_2022::ID {
            return err!(CryptoScrabbleError::WrongTokenProgram);
        }
        if mint_ai.key() != cfg.letter_mints[letter_idx] {
            return err!(CryptoScrabbleError::MintMismatch);
        }
        let ata_data = ata_ai.try_borrow_data()?;
        if ata_data.len() < tlayout::ATA_DATA_LEN {
            return err!(CryptoScrabbleError::TokenAccountMintMismatch);
        }
        let ata_mint =
            Pubkey::try_from(&ata_data[tlayout::ATA_MINT_OFF..tlayout::ATA_MINT_OFF + 32])
                .map_err(|_| error!(CryptoScrabbleError::TokenAccountMintMismatch))?;
        let ata_owner =
            Pubkey::try_from(&ata_data[tlayout::ATA_OWNER_OFF..tlayout::ATA_OWNER_OFF + 32])
                .map_err(|_| error!(CryptoScrabbleError::TokenAccountOwnerMismatch))?;
        if ata_mint != mint_ai.key() {
            return err!(CryptoScrabbleError::TokenAccountMintMismatch);
        }
        if ata_owner != *player_info.key {
            return err!(CryptoScrabbleError::TokenAccountOwnerMismatch);
        }
        let bal = u64::from_le_bytes(
            ata_data[tlayout::ATA_AMOUNT_OFF..tlayout::ATA_AMOUNT_OFF + 8]
                .try_into()
                .unwrap(),
        );
        drop(ata_data);
        if bal < burn_qty {
            return err!(CryptoScrabbleError::InsufficientTokenBalance);
        }

        let cpi_ctx = CpiContext::new(
            token_prog_info.clone(),
            Burn {
                mint: mint_ai,
                from: ata_ai,
                authority: player_info.clone(),
            },
        );
        burn(cpi_ctx, burn_qty)?;
        burned_units += burn_qty;
    }

    // ---------- scoring ----------
    let score: u64 = args
        .letters
        .iter()
        .map(|c| LETTER_VALUES[(c - b'a') as usize])
        .try_fold(0u64, |acc, v| acc.checked_add(v))
        .ok_or_else(|| error!(CryptoScrabbleError::MathOverflow))?;
    let payout = score
        .checked_mul(cfg.payout_per_point_lamports)
        .ok_or_else(|| error!(CryptoScrabbleError::MathOverflow))?;

    // ---------- SOL flows ----------
    // entry fee: player -> vault
    let sys_prog = ctx.accounts.system_program.to_account_info();
    anchor_lang::system_program::transfer(
        CpiContext::new(
            sys_prog.clone(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        cfg.entry_fee_lamports,
    )?;

    // payout: vault -> player, capped so the vault stays rent exempt
    let rent = Rent::get()?;
    let rent_min = rent.minimum_balance(0);
    let available = ctx
        .accounts
        .vault
        .lamports()
        .checked_sub(rent_min)
        .unwrap_or(0);
    if payout > available {
        return err!(CryptoScrabbleError::TreasuryInsolvent);
    }
    let vault_bump = cfg.vault_bump;
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];
    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            sys_prog,
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.player.to_account_info(),
            },
            &[vault_seeds],
        ),
        payout,
    )?;

    // ---------- commit state ----------
    let player_key = ctx.accounts.player.key();
    for &i in &new_positions {
        let cx = (sx + dx * i as isize) as usize;
        let cy = (sy + dy * i as isize) as usize;
        board.cells[GameBoard::idx(cx, cy)] = Cell {
            occupied: 1,
            letter: args.letters[i],
            player: player_key,
        };
    }
    board.words_played += 1;

    cfg.total_words_played += 1;
    cfg.total_payout_lamports = cfg
        .total_payout_lamports
        .checked_add(payout)
        .ok_or_else(|| error!(CryptoScrabbleError::MathOverflow))?;
    cfg.total_burned_units = cfg
        .total_burned_units
        .checked_add(burned_units)
        .ok_or_else(|| error!(CryptoScrabbleError::MathOverflow))?;

    emit!(WordPlayed {
        player: player_key,
        word: String::from_utf8(word_bytes)
            .map_err(|_| error!(CryptoScrabbleError::InvalidLetterBytes))?,
        score_points: score,
        payout_lamports: payout,
        entry_fee_lamports: cfg.entry_fee_lamports,
        burned_units,
        tiles_placed: new_positions.len() as u8,
    });
    Ok(())
}

fn verify_merkle_proof(
    root: [u8; 32],
    word: &[u8],
    mut index: u32,
    proof: &[[u8; 32]],
) -> Result<()> {
    use solana_program::hash::{hashv, Hasher};

    let mut hasher = Hasher::default();
    hasher.hash(word);
    let mut current = hasher.result().to_bytes();

    for sibling in proof {
        current = if index % 2 == 0 {
            hashv(&[current.as_ref(), sibling.as_ref()]).to_bytes()
        } else {
            hashv(&[sibling.as_ref(), current.as_ref()]).to_bytes()
        };
        index /= 2;
    }
    require!(current == root, CryptoScrabbleError::DictionaryProofFailed);
    Ok(())
}
