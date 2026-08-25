use anchor_lang::prelude::*;

#[error_code]
pub enum CryptoScrabbleError {
    #[msg("Word must be between 2 and 15 letters")]
    InvalidWordLength,
    #[msg("Run is out of board bounds")]
    OutOfBounds,
    #[msg("At least one new tile must be placed")]
    NoNewTiles,
    #[msg("Letters/mask length mismatch")]
    LengthMismatch,
    #[msg("First word must cover the center square")]
    FirstMoveNotOnCenter,
    #[msg("New tiles must connect to the existing board")]
    NotConnected,
    #[msg("Cannot overwrite an occupied cell")]
    CellOccupied,
    #[msg("Existing cell letter does not match submitted run")]
    ExistingLetterMismatch,
    #[msg("Dictionary proof failed - word not in dictionary")]
    DictionaryProofFailed,
    #[msg("Proof longer than maximum supported depth")]
    ProofTooLong,
    #[msg("Invalid letters payload (bytes must be a-z)")]
    InvalidLetterBytes,
    #[msg("Mint does not match the registered letter mint")]
    MintMismatch,
    #[msg("Token account is not owned by the signer")]
    TokenAccountOwnerMismatch,
    #[msg("Token account mint mismatch")]
    TokenAccountMintMismatch,
    #[msg("Token program must be SPL Token-2022")]
    WrongTokenProgram,
    #[msg("Insufficient letter token balance to burn")]
    InsufficientTokenBalance,
    #[msg("Treasury cannot cover this payout")]
    TreasuryInsolvent,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
