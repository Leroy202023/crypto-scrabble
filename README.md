# Crypto Scrabble

A **burn-to-play** Scrabble game on Solana. Players spend Token-2022 letter
tokens to place words on a shared 15×15 on-chain board: each play **burns** the
letter tokens, pays a small entry fee, proves the word against an on-chain
SHA-256 merkle dictionary, and earns SOL from a vault proportional to Scrabble
points — **including every perpendicular cross-word formed** and **premium
squares** (double/triple letter & word multipliers apply to the tiles you
place).

- **Program:** Anchor 0.32 / Solana 2.3, Token-2022 letter mints (2% transfer
  fee), zero-copy PDAs for the config + board.
- **Client:** Vite + React 18, `@solana/wallet-adapter` (Phantom/Solflare).
- **Dictionary:** 172,820 words → SHA-256 merkle tree; the root lives on-chain
  and every play is verified against it.

## Architecture

| Piece | Location | Notes |
|---|---|---|
| On-chain program | `program/` | 4 instructions: `initialize`, `set_letter_mints`, `submit_word`, `set_authority` |
| Web app | `app/` | Board, rack, submit panel, stats, market (Jupiter swap links) |
| Shared logic | `shared/` | `program.ts` (PDAs, scoring), `merkle.ts`, `gameplay.ts` (placement engine) |
| Scripts | `scripts/` | launch letters, build merkle, init game, airdrop, local playtest, devnet faucet farmer |
| Treasury bot | `bot/` | harvests withheld Token-2022 fees → swaps → tops up vault |

### Game flow
1. `launch_letters.ts` creates 26 Token-2022 mints (frequency-weighted supply,
   Q/Z scarce). 8% parked in the treasury.
2. `build_dictionary_merkle.ts` builds the 172k-word merkle tree → `data/merkle_root.txt`.
3. `init_game.ts` calls `initialize` (sets root + economy) and `set_letter_mints`,
   then funds the SOL vault.
4. Player connects a wallet, sees their 26 letter-token balances as a rack,
   places tiles, and clicks **Burn & Submit**.
5. `submit_word` validates the placement, verifies the word + every cross-word
   against the merkle root, burns the tiles, collects the entry fee, and pays
   out `(main + cross-word points) × payout_per_point` from the vault.

### Economy (defaults)
- Entry fee: **0.05 SOL** per play
- Payout: **0.005 SOL per Scrabble point**
- Burn: **1000 tokens per placed tile** (forever removed from supply)

## Local development

Requires `solana`, `anchor` (0.32), and `node >= 20`.

```bash
# 1. start a fresh local validator with the program loaded
solana-test-validator --reset --quiet \
  --bpf-program AJVQGSNjciPGhotWNtoRSocWEVWGtFQNqkSVzmgiYMtx target/deploy/crypto_scrabble.so \
  --rpc-port 8899 &
# fund the authority keypair (~/.config/solana/id.json) used by the scripts
solana airdrop 100   # then transfer to the script's authority if needed

# 2. build + launch
anchor build
npm run launch:letters
npm run build:merkle
npm run init:game

# 3. play (scripted, real 172k dictionary) or via the UI
npx tsx scripts/local_playtest.ts cat
npm run app:dev

# 4. tests
anchor test            # on-chain e2e (spins its own validator)
npm test               # unit: merkle + gameplay + submitWord encoding
npm run app:typecheck
```

> The scripts default to the localnet validator and the
> `~/.config/solana/id.json` keypair as authority. Airdrop/transfer SOL to that
> keypair before `init:game`.

## Treasury bot

```bash
# discover players via WordPlayed events, harvest withheld fees, withdraw to
# the treasury ATA, optionally swap+deposit. SWAP=1 enables Jupiter conversion.
BOT_KEYPAIR=~/.config/solana/id.json npx tsx bot/src/index.ts --once
```

**Note on the "Volume Tax":** Token-2022 transfer fees are withheld on
`transfer` instructions, **not** on `burn`. Because plays burn tokens (rather
than transfer them), withheld fees do not currently accrue from normal play —
the harvesting machinery is complete and will engage for any transfers that do
occur (e.g. secondary token markets). This is a known design simplification.

## Deploying elsewhere

`deployment.json` and `app/public/deployment.json` capture the cluster, program
id, PDAs, merkle root, and economy. Point `Anchor.toml` / `VITE_RPC_URL` at your
cluster and re-run `launch:letters` → `build:merkle` → `init:game` against it.

## Live deployment (devnet)

- **App + landing page:** https://crypto-scrabble-devnet.vercel.app — landing at `/`,
  game at `/play`. The network switcher in the top bar flips the whole client
  between localnet / devnet / mainnet at runtime.
- **Program:** `AJVQGSNjciPGhotWNtoRSocWEVWGtFQNqkSVzmgiYMtx` — premium squares
  (DL/TL/DW/TW) are live on-chain; only tiles placed this turn claim a premium,
  and the center star doubles the first word.
- Static deploy: `npm run app:build && npx vercel deploy --prod --project crypto-scrabble-devnet app/dist`

## Operations runbook

```bash
# starter rack for a new player (devnet beta — mints fresh letters, no transfer fee)
RPC_URL=https://api.devnet.solana.com \
AUTHORITY_KEYPAIR=~/.config/solana/devnet-deploy.json \
  npx tsx scripts/dev_airdrop.ts <PLAYER_PUBKEY> e=4000 a=4000 r=4000 t=4000 o=4000 s=4000 n=2000

# top up the payout vault when it runs low
RPC_URL=https://api.devnet.solana.com AMOUNT_SOL=0.5 \
AUTHORITY_KEYPAIR=~/.config/solana/devnet-deploy.json \
  npx tsx scripts/topup_vault.ts

# verify a scripted word against live devnet (prints real payout breakdown)
RPC_URL=https://api.devnet.solana.com AUTHORITY_KEYPAIR=~/.config/solana/devnet-deploy.json \
  npx tsx scripts/local_playtest.ts cot START_X=6 START_Y=7 DIRECTION=1 BRIDGE=1
```

The app shows an empty-rack hint with a copy-address button so new players can
request a starter rack. When the vault hits its rent floor, plays fail with a
friendly "vault needs a top-up" message.

> **Key security.** The upgrade authority (`devnet-deploy.json` on devnet) can
> replace the program and is never committed (`**/*-keypair.json` is
> gitignored). For mainnet, move this key to a hardware wallet or Squads
> multisig before deploying.

### Mainnet checklist

1. Fund a fresh authority wallet (hardware/multisig) with SOL (~4 for deploy buffer + float).
2. `anchor build && solana program deploy target/deploy/crypto_scrabble.so --program-id <new-keypair>` on mainnet.
3. Re-run `launch:letters` → `build:merkle` → `init:game` with `RPC_URL=https://api.mainnet-beta.solana.com`.
4. Fill in mainnet `programId` + `deployed: true` in `app/src/lib/clusters.ts`; commit the generated `deployment.mainnet.json` / `letters.mainnet.json` into `app/public/`.
5. Consider a paid RPC (public mainnet rate-limits hard); update `clusters.ts` rpc url.
6. Seed Jupiter liquidity for letter mints so the market panel trades for real.
7. Update OG/meta URLs in `app/index.html` if the domain changes; redeploy.

## CI

`.github/workflows/ci.yml` builds the program, runs the Anchor e2e suite, the
Vitest unit suite, and typechecks the app on every push/PR.
