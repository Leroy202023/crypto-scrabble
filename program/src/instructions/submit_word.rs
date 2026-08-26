use anchor_lang::prelude::*;
use anchor_spl::token_2022;
use anchor_spl::token_interface::{burn, Burn, TokenInterface};

use crate::errors::CryptoScrabbleError;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct CrossWordProof {
    /// Index of the cross word's leaf in the dictionary merkle tree.
    pub leaf_index: u32,
    /// Sibling hashes, nearest-first (same encoding as the main word proof).
    pub proof: Vec<[u8; 32]>,
}

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
    /// true where the corresponding NEW tile is a blank (wildcard). Blanks burn
    /// the blank mint and score 0 points. Positions that are not new must be
    /// false. Parallel to `letters`.
    pub blank_mask: Vec<bool>,
    /// Index of this word's leaf in the dictionary merkle tree.
    pub leaf_index: u32,
    /// Sibling hashes, nearest-first.
    pub proof: Vec<[u8; 32]>,
    /// One proof per perpendicular cross-word formed, in the canonical order
    /// produced by the shared client engine (new tiles in run order, deduped).
    pub cross_words: Vec<CrossWordProof>,
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
    if args.blank_mask.len() != n {
        return err!(CryptoScrabbleError::LengthMismatch);
    }
    // blanks may only be declared on newly placed tiles
    for i in 0..n {
        if !args.new_mask[i] && args.blank_mask[i] {
            return err!(CryptoScrabbleError::InvalidLetterBytes);
        }
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

    // ---------- cross-word verification ----------
    // Build a preview board (existing cells + the tiles being placed now) so we
    // can detect every perpendicular cross-word the same way the shared client
    // engine does, then verify each one against the merkle root. A parallel
    // blank map tracks which preview cells are blanks so they score 0.
    let mut preview: Vec<u8> = vec![0u8; TOTAL_CELLS];
    let mut preview_blank: Vec<u8> = vec![0u8; TOTAL_CELLS];
    for i in 0..TOTAL_CELLS {
        if board.cells[i].occupied != 0 {
            preview[i] = board.cells[i].letter;
            preview_blank[i] = board.cells[i].blank;
        }
    }
    for (i, &ch) in args.letters.iter().enumerate() {
        if args.new_mask[i] {
            let cx = (sx + dx * i as isize) as usize;
            let cy = (sy + dy * i as isize) as usize;
            preview[GameBoard::idx(cx, cy)] = ch;
            preview_blank[GameBoard::idx(cx, cy)] = args.blank_mask[i] as u8;
        }
    }
    let computed_crosses = detect_cross_words(
        &preview,
        sx,
        sy,
        dx,
        dy,
        &args.letters,
        &args.new_mask,
    );
    if computed_crosses.len() != args.cross_words.len() {
        return err!(CryptoScrabbleError::CrossWordCountMismatch);
    }
    let mut new_cell_idx: std::collections::HashSet<usize> = std::collections::HashSet::new();
    for &i in &new_positions {
        let cx = (sx + dx * i as isize) as usize;
        let cy = (sy + dy * i as isize) as usize;
        new_cell_idx.insert(GameBoard::idx(cx, cy));
    }
    let cross_positions = cross_word_positions(&preview, sx, sy, dx, dy, &args.new_mask);
    let mut cross_score: u64 = 0;
    for (j, (cw, proof)) in computed_crosses
        .iter()
        .zip(args.cross_words.iter())
        .enumerate()
    {
        if proof.proof.len() > MAX_PROOF_LEN {
            return err!(CryptoScrabbleError::ProofTooLong);
        }
        verify_merkle_proof(cfg.merkle_root, cw, proof.leaf_index, &proof.proof)?;
        let pos = &cross_positions[j];
        let is_new: Vec<bool> = pos.iter().map(|p| new_cell_idx.contains(p)).collect();
        let is_blank: Vec<bool> = pos.iter().map(|&p| preview_blank[p] != 0).collect();
        let pts = score_word_with_bonuses(pos, cw, &is_new, &is_blank)?;
        cross_score = cross_score.checked_add(pts).ok_or_else(|| error!(CryptoScrabbleError::MathOverflow))?;
    }

    // ---------- burns ----------
    let burn_qty = cfg.burn_quantity_per_tile;
    let player_info = ctx.accounts.player.to_account_info();
    let token_prog_info = ctx.accounts.token_program.to_account_info();
    let mut burned_units: u64 = 0;
    for (k, &i) in new_positions.iter().enumerate() {
        let is_blank = args.blank_mask[i];
        let expected_mint = if is_blank {
            cfg.blank_mint
        } else {
            let letter_idx = (args.letters[i] - b'a') as usize;
            cfg.letter_mints[letter_idx]
        };
        let mint_ai = ctx.remaining_accounts[k * 2].to_account_info();
        let ata_ai = ctx.remaining_accounts[k * 2 + 1].to_account_info();

        // program identity checks
        if *mint_ai.owner != token_2022::ID {
            return err!(CryptoScrabbleError::WrongTokenProgram);
        }
        if mint_ai.key() != expected_mint {
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

    // ---------- scoring (premium-aware) ----------
    // A premium square only matters when a NEW tile is placed on it (existing
    // tiles already counted their own premium when they were played). Blanks
    // score 0 regardless of any premium underneath them.
    let main_positions: Vec<usize> = (0..n)
        .map(|i| {
            GameBoard::idx(
                (sx + dx * i as isize) as usize,
                (sy + dy * i as isize) as usize,
            )
        })
        .collect();
    let main_is_new: Vec<bool> = args.new_mask.clone();
    let main_is_blank: Vec<bool> = (0..n)
        .map(|i| {
            if args.new_mask[i] {
                args.blank_mask[i]
            } else {
                let cx = (sx + dx * i as isize) as usize;
                let cy = (sy + dy * i as isize) as usize;
                board.cells[GameBoard::idx(cx, cy)].blank == 1
            }
        })
        .collect();
    let main_score =
        score_word_with_bonuses(&main_positions, &args.letters, &main_is_new, &main_is_blank)?;
    let score = main_score
        .checked_add(cross_score)
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
            blank: args.blank_mask[i] as u8,
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

    let cross_words: Vec<String> = computed_crosses
        .iter()
        .map(|cw| String::from_utf8(cw.clone()).unwrap())
        .collect();

    emit!(WordPlayed {
        player: player_key,
        word: String::from_utf8(word_bytes)
            .map_err(|_| error!(CryptoScrabbleError::InvalidLetterBytes))?,
        main_score_points: main_score,
        score_points: score,
        cross_words,
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

/// (mirrors the shared client's blank-aware scoreWord).
fn score_letters(word: &[u8], blanks: &[bool]) -> Result<u64> {
    let mut acc: u64 = 0;
    for (i, &c) in word.iter().enumerate() {
        if blanks.get(i).copied().unwrap_or(false) {
            continue;
        }
        acc = acc.checked_add(LETTER_VALUES[(c - b'a') as usize])
            .ok_or_else(|| error!(CryptoScrabbleError::MathOverflow))?;
    }
    Ok(acc)
}

/// Classic Scrabble premium layout (identical to the client's board). Each row
/// is 15 chars: T=triple word, D=double word, t=triple letter, d=double letter,
/// *=center (double word), -=plain.
const PREMIUM_CHARS: [&str; BOARD_SIZE] = [
    "T--d---T---d--T",
    "-D---t---t---D-",
    "--D---d-d---D--",
    "d--D---d---D--d",
    "----D-----D----",
    "-t---t---t---t-",
    "--d---d-d---d--",
    "T--d---*---d--T",
    "--d---d-d---d--",
    "-t---t---t---t-",
    "----D-----D----",
    "d--D---d---D--d",
    "--D---d-d---D--",
    "-D---t---t---D-",
    "T--d---T---d--T",
];

/// (word_multiplier, letter_multiplier) for a board cell index.
fn premium_at(idx: usize) -> (u64, u64) {
    let y = idx / BOARD_SIZE;
    let x = idx % BOARD_SIZE;
    match PREMIUM_CHARS[y].as_bytes()[x] {
        b'T' => (3, 1), // triple word
        b'D' => (2, 1), // double word
        b't' => (1, 3), // triple letter
        b'd' => (1, 2), // double letter
        b'*' => (2, 1), // center (double word)
        _ => (1, 1),
    }
}

/// Premium-aware word score. Letter multipliers apply only to new, non-blank
/// tiles on a (double/triple) letter square; word multipliers apply once per
/// word for every new, non-blank tile sitting on a (double/triple) word square.
/// Blanks always score 0. `positions` is the board indices of the word's cells,
/// parallel to `letters`/`is_new`/`is_blank`.
fn score_word_with_bonuses(
    positions: &[usize],
    letters: &[u8],
    is_new: &[bool],
    is_blank: &[bool],
) -> Result<u64> {
    let mut word_mult: u64 = 1;
    let mut letter_sum: u64 = 0;
    for i in 0..letters.len() {
        if is_blank.get(i).copied().unwrap_or(false) {
            continue; // blanks score 0
        }
        let base = LETTER_VALUES[(letters[i] - b'a') as usize] as u64;
        let mut pts = base;
        if is_new.get(i).copied().unwrap_or(false) {
            let (wm, lm) = premium_at(positions[i]);
            pts = pts * lm;
            word_mult = word_mult
                .checked_mul(wm)
                .ok_or_else(|| error!(CryptoScrabbleError::MathOverflow))?;
        }
        letter_sum = letter_sum
            .checked_add(pts)
            .ok_or_else(|| error!(CryptoScrabbleError::MathOverflow))?;
    }
    Ok(letter_sum * word_mult)
}

/// Board indices of each perpendicular cross-word, in the same canonical order
/// as `detect_cross_words`. Used to apply premium multipliers to cross words.
fn cross_word_positions(
    preview: &[u8],
    sx: isize,
    sy: isize,
    dx: isize,
    dy: isize,
    new_mask: &[bool],
) -> Vec<Vec<usize>> {
    let cdx: isize = if dx == 0 { 1 } else { 0 };
    let cdy: isize = if dy == 0 { 1 } else { 0 };
    let mut out: Vec<Vec<usize>> = Vec::new();
    for (i, _) in new_mask.iter().enumerate() {
        if !new_mask[i] {
            continue;
        }
        let cx = sx + dx * i as isize;
        let cy = sy + dy * i as isize;
        let mut bx = cx;
        let mut by = cy;
        loop {
            let nx = bx - cdx;
            let ny = by - cdy;
            if nx < 0 || ny < 0 || nx >= BOARD_SIZE as isize || ny >= BOARD_SIZE as isize {
                break;
            }
            if preview[GameBoard::idx(nx as usize, ny as usize)] == 0 {
                break;
            }
            bx = nx;
            by = ny;
        }
        let mut ex = cx;
        let mut ey = cy;
        loop {
            let nx = ex + cdx;
            let ny = ey + cdy;
            if nx < 0 || ny < 0 || nx >= BOARD_SIZE as isize || ny >= BOARD_SIZE as isize {
                break;
            }
            if preview[GameBoard::idx(nx as usize, ny as usize)] == 0 {
                break;
            }
            ex = nx;
            ey = ny;
        }
        let cross_len = ((ex - bx) * cdx + (ey - by) * cdy + 1) as usize;
        if cross_len >= 2 {
            let mut pos: Vec<usize> = Vec::with_capacity(cross_len);
            let mut x = bx;
            let mut y = by;
            loop {
                pos.push(GameBoard::idx(x as usize, y as usize));
                if x == ex && y == ey {
                    break;
                }
                x += cdx;
                y += cdy;
            }
            out.push(pos);
        }
    }
    out
}

/// Perpendicular cross-words formed by THIS move, in canonical order
/// (new tiles in ascending run order). A cross word is the maximal contiguous
/// orthogonal run through a newly placed tile on the preview board (which already
/// includes both existing tiles and the tiles being placed this turn). Only
/// runs of length >= 2 are returned. Byte-identical ordering to the shared
/// client engine so a valid play produces a matching proof set.
fn detect_cross_words(
    preview: &[u8],
    sx: isize,
    sy: isize,
    dx: isize,
    dy: isize,
    letters: &[u8],
    new_mask: &[bool],
) -> Vec<Vec<u8>> {
    // perpendicular axis to the main run
    let cdx: isize = if dx == 0 { 1 } else { 0 };
    let cdy: isize = if dy == 0 { 1 } else { 0 };
    let mut out: Vec<Vec<u8>> = Vec::new();
    for (i, _) in letters.iter().enumerate() {
        if !new_mask[i] {
            continue;
        }
        let cx = sx + dx * i as isize;
        let cy = sy + dy * i as isize;
        // walk back to start of the perpendicular run
        let mut bx = cx;
        let mut by = cy;
        loop {
            let nx = bx - cdx;
            let ny = by - cdy;
            if nx < 0 || ny < 0 || nx >= BOARD_SIZE as isize || ny >= BOARD_SIZE as isize {
                break;
            }
            let cell = preview[GameBoard::idx(nx as usize, ny as usize)];
            if cell == 0 {
                break;
            }
            bx = nx;
            by = ny;
        }
        // walk forward to end of the perpendicular run
        let mut ex = cx;
        let mut ey = cy;
        loop {
            let nx = ex + cdx;
            let ny = ey + cdy;
            if nx < 0 || ny < 0 || nx >= BOARD_SIZE as isize || ny >= BOARD_SIZE as isize {
                break;
            }
            let cell = preview[GameBoard::idx(nx as usize, ny as usize)];
            if cell == 0 {
                break;
            }
            ex = nx;
            ey = ny;
        }
        let cross_len = ((ex - bx) * cdx + (ey - by) * cdy + 1) as usize;
        if cross_len >= 2 {
            let mut word: Vec<u8> = Vec::with_capacity(cross_len);
            let mut x = bx;
            let mut y = by;
            loop {
                // preview already contains the new tiles' letters, so every
                // cell on this perpendicular run is just a preview lookup.
                word.push(preview[GameBoard::idx(x as usize, y as usize)]);
                if x == ex && y == ey {
                    break;
                }
                x += cdx;
                y += cdy;
            }
            out.push(word);
        }
    }
    out
}
