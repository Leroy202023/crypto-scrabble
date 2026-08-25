// End-to-end Anchor test: initialize -> create Token-2022 tile mints ->
// play "CAT" as the first word -> verify burn, payout and board state.
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { expect } from 'chai';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMintLen,
} from '@solana/spl-token';
import CryptoScrabble from '../../target/types/crypto_scrabble';
import { buildTree, getProof, wordToLeaf } from '../../shared/merkle';

const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

describe('crypto-scrabble', () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.CryptoScrabble as Program<CryptoScrabble>;
  const authority = (program.provider as anchor.AnchorProvider).wallet;

  const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)[0];
  const boardPda = PublicKey.findProgramAddressSync([Buffer.from('board')], program.programId)[0];
  const vaultPda = PublicKey.findProgramAddressSync([Buffer.from('vault')], program.programId)[0];

  // tiny deterministic dictionary - same merkle implementation as the production launch script
  const DICT = ['at', 'cat', 'dog', 'hat', 'rat', 'sun']; // 6 words -> padded to 8 leaves
  const tree = buildTree(DICT);
  const catLeafIndex = tree.leaves.findIndex((l) => Buffer.from(l).equals(Buffer.from(wordToLeaf('cat'))));
  const root = [...tree.root];

  const mintKps: Record<string, Keypair> = {
    c: Keypair.generate(), a: Keypair.generate(), t: Keypair.generate(),
  };
  const player = Keypair.generate();
  const BURN_QTY = new anchor.BN(1000);
  const ENTRY_FEE = new anchor.BN(0.02 * LAMPORTS_PER_SOL);
  const PER_POINT = new anchor.BN(0.005 * LAMPORTS_PER_SOL);

  const ataOf = (owner: PublicKey, mint: PublicKey) =>
    getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID, ATA_PROGRAM);

  async function registerMints() {
    const arr: PublicKey[] = Array.from({ length: 26 }, () => PublicKey.default);
    arr['c'.charCodeAt(0) - 97] = mintKps.c.publicKey;
    arr['a'.charCodeAt(0) - 97] = mintKps.a.publicKey;
    arr['t'.charCodeAt(0) - 97] = mintKps.t.publicKey;
    await program.methods
      .setLetterMints(arr)
      .accounts({ authority: authority.publicKey, config: configPda })
      .rpc();
  }

  async function createPlainToken2022Mint(kp: Keypair) {
    const space = getMintLen([]);
    const lamports = await program.provider.connection.getMinimumBalanceForRentExemption(space);
    await program.provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: authority.publicKey,
          newAccountPubkey: kp.publicKey,
          space,
          lamports,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeMintInstruction(kp.publicKey, 0, authority.publicKey, null, TOKEN_2022_PROGRAM_ID),
      ),
      [kp],
    );
  }

  before(async () => {
    await program.provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: player.publicKey,
          lamports: 5 * LAMPORTS_PER_SOL,
        }),
      ),
    );

    for (const l of ['c', 'a', 't']) await createPlainToken2022Mint(mintKps[l]);

    await program.methods
      .initialize(root, ENTRY_FEE, PER_POINT, BURN_QTY)
      .accounts({ authority: authority.publicKey, config: configPda, board: boardPda, vault: vaultPda })
      .rpc();

    await registerMints();

    for (const l of ['c', 'a', 't']) {
      const mint = mintKps[l].publicKey;
      const dest = ataOf(player.publicKey, mint);
      await program.provider.sendAndConfirm(
        new Transaction().add(
          createAssociatedTokenAccountInstruction(authority.publicKey, dest, player.publicKey, mint, TOKEN_2022_PROGRAM_ID, ATA_PROGRAM),
          createMintToInstruction(mint, dest, authority.publicKey, 10_000, [], TOKEN_2022_PROGRAM_ID),
        ),
      );
    }

    await program.provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: vaultPda, lamports: 2 * LAMPORTS_PER_SOL }),
      ),
    );
  });

  it('initialized config + empty board', async () => {
    const cfg = await program.account.gameConfig.fetch(configPda);
    expect(cfg.authority.toString()).to.equal(authority.publicKey.toString());
    expect([...cfg.merkleRoot]).to.deep.equal(root);
    expect(cfg.totalWordsPlayed.toString()).to.equal('0');
    const board = await program.account.gameBoard.fetch(boardPda);
    expect(board.wordsPlayed.toString()).to.equal('0');
  });

  it('rejects a word that is not in the dictionary (proof fails)', async () => {
    const proof = getProof(tree, catLeafIndex);
    try {
      await program.methods
        .submitWord({
          startX: 6, startY: 7, direction: 0,
          letters: Buffer.from("zzz", "ascii"), // not in DICT
          newMask: [true, true, true],
          leafIndex: catLeafIndex, // valid index, wrong word -> leaf mismatch
          proof: proof.map((p) => Buffer.from(p)),
        })
        .accounts({ player: player.publicKey, config: configPda, board: boardPda, vault: vaultPda, tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .remainingAccounts([
          { pubkey: mintKps.c.publicKey, isSigner: false, isWritable: true },
          { pubkey: ataOf(player.publicKey, mintKps.c.publicKey), isSigner: false, isWritable: true },
          { pubkey: mintKps.c.publicKey, isSigner: false, isWritable: true },
          { pubkey: ataOf(player.publicKey, mintKps.c.publicKey), isSigner: false, isWritable: true },
          { pubkey: mintKps.c.publicKey, isSigner: false, isWritable: true },
          { pubkey: ataOf(player.publicKey, mintKps.c.publicKey), isSigner: false, isWritable: true },
        ])
        .signers([player])
        .rpc();
      expect.fail('should have thrown DictionaryProofFailed');
    } catch (e: any) {
      expect(String(e)).to.match(/DictionaryProofFailed|custom program error/i);
    }
  });

  it('plays CAT as the first move: burns 1000/tile and pays score*perPoint', async () => {
    const proof = getProof(tree, catLeafIndex);
    const before = await program.provider.connection.getBalance(player.publicKey);

    await program.methods
      .submitWord({
        startX: 6, startY: 7, direction: 0,
        letters: Buffer.from("cat", "ascii"),
        newMask: [true, true, true],
        leafIndex: catLeafIndex,
        proof: proof.map((p) => Buffer.from(p)),
      })
      .accounts({ player: player.publicKey, config: configPda, board: boardPda, vault: vaultPda, tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .remainingAccounts([
        { pubkey: mintKps.c.publicKey, isSigner: false, isWritable: true },
        { pubkey: ataOf(player.publicKey, mintKps.c.publicKey), isSigner: false, isWritable: true },
        { pubkey: mintKps.a.publicKey, isSigner: false, isWritable: true },
        { pubkey: ataOf(player.publicKey, mintKps.a.publicKey), isSigner: false, isWritable: true },
        { pubkey: mintKps.t.publicKey, isSigner: false, isWritable: true },
        { pubkey: ataOf(player.publicKey, mintKps.t.publicKey), isSigner: false, isWritable: true },
      ])
      .signers([player])
      .rpc();

    // burns happened
    for (const l of ['c', 'a', 't']) {
      const acct = await getAccount(
        program.provider.connection,
        ataOf(player.publicKey, mintKps[l].publicKey),
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      expect(acct.amount.toString()).to.equal('9000');
    }

    // net lamports = payout - entry fee - tx fee
    const after = await program.provider.connection.getBalance(player.publicKey);
    const score = 5; // c=3 a=1 t=1
    const netExpected = score * PER_POINT.toNumber() - ENTRY_FEE.toNumber();
    // allow the ~5000 lamport tx fee
    expect(after).to.be.greaterThan(before + netExpected - 10_000);
    expect(after).to.be.lessThan(before + netExpected + 1);

    const board = await program.account.gameBoard.fetch(boardPda);
    expect(board.wordsPlayed.toString()).to.equal('1');

    const cfg = await program.account.gameConfig.fetch(configPda);
    expect(cfg.totalWordsPlayed.toString()).to.equal('1');
    expect(cfg.totalBurnedUnits.toString()).to.equal('3000');
  });

  it('rejects overwriting an occupied cell', async () => {
    const proof = getProof(tree, catLeafIndex);
    try {
      await program.methods
        .submitWord({
          startX: 7, startY: 7, direction: 0,
          letters: Buffer.from("at", "ascii"), // starts on the occupied center 'a'
          newMask: [true, true],
          leafIndex: tree.leaves.findIndex((l) => Buffer.from(l).equals(Buffer.from(wordToLeaf('at')))),
          proof: proof.map((p) => Buffer.from(p)),
        })
        .accounts({ player: player.publicKey, config: configPda, board: boardPda, vault: vaultPda, tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .remainingAccounts([
          { pubkey: mintKps.a.publicKey, isSigner: false, isWritable: true },
          { pubkey: ataOf(player.publicKey, mintKps.a.publicKey), isSigner: false, isWritable: true },
          { pubkey: mintKps.t.publicKey, isSigner: false, isWritable: true },
          { pubkey: ataOf(player.publicKey, mintKps.t.publicKey), isSigner: false, isWritable: true },
        ])
        .signers([player])
        .rpc();
      expect.fail('should have thrown CellOccupied');
    } catch (e: any) {
      expect(String(e)).to.match(/CellOccupied|custom program error/i);
    }
  });
});
