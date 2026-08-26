# Scrabble Bags — NFT collection spec

A **Scrabble Bag** is a Solana NFT that, when opened, disburses a random
assortment of **letter tokens** (the same Token-2022 mints the game burns) into
the opener's wallet — i.e. you crack the bag and get tiles to play with. Every
bag is different ("all bags vary"): the exact tile mix is determined by a
seeded RNG keyed to the bag's mint index, so the loot table is verifiable and
reproducible from on-chain data.

## Why it fits the game

- Letter tokens are the currency of play; bags are the **acquisition funnel**
  (an alternative to buying individual letters on Jupiter).
- Burning on play makes supply *deflationary*, so opening bags is the faucet
  that keeps the board fed.
- The 27th `$*` mint (the blank/wildcard) is the rarest, most coveted drop.

## Bag rarity tiers

| Tier | Supply | Tile count | Blank chance | Letter bias |
|---|---|---|---|---|
| **Common** | 70% | 12–16 | 6% → 1 blank | standard Scrabble frequency |
| **Rare** | 22% | 15–19 | 45% → 1 blank | +high-value tilt (Q/Z/J/X more likely) |
| **Legendary** | 8% | 18–22 | 100% → 2 blanks | vowel-rich **and** guaranteed one Q or Z |

Every bag also carries a small **SOL voucher** (vault-funded) redeemable as the
entry fee for a few plays, so a fresh bag can be played immediately.

## Letter weighting

Draws use the classic Scrabble tile frequency as the base distribution, shifted
per tier. The generation scaffold (`scripts/nft/generate_bags.ts`) encodes this
as a per-tier weighted CDF so the output is deterministic for a given seed.

## Metadata layout (Metaplex-compatible)

```jsonc
{
  "name": "Scrabble Bag #123",
  "tier": "rare",
  "rng_seed": "0x4f3a…",          // on-chain-verifiable
  "contents": [                    // revealed on open
    { "letter": "e", "qty": 3 },
    { "letter": "*", "qty": 1 },
    { "letter": "q", "qty": 1 }
  ],
  "sol_voucher_lamports": 150000000, // ~0.15 SOL
  "image": "ipfs://…/123.png",
  "attributes": [
    { "trait_type": "Tier", "value": "rare" },
    { "trait_type": "Tiles", "value": 5 },
    { "trait_type": "Blanks", "value": 1 }
  ]
}
```

## On-chain plan (you build this)

1. **Mint**: Metaplex Core or compressed (cNFT) collection. Each bag is one NFT
   whose `rng_seed` is stored in on-chain metadata (or derived from the mint
   address + collection authority signature).
2. **Open**: an `open_bag` instruction that:
   - verifies the bag belongs to the collection,
   - derives the loot table from `rng_seed` (identical logic to the generation
     scaffold — keep the weighting table in a shared module),
   - mints the letter tokens to the opener (authority-signed `mint_to` CPIs to
     the 26 + blank Token-2022 mints),
   - optionally transfers the SOL voucher from the vault,
   - burns/marks the bag as opened (or sets `opened: true` in its PDA).
3. **Reveal**: contents stay hidden until `open_bag` is called; the scaffold's
   `contents` field is the canonical expected output for that seed, so marketplaces
   and the game client can pre-render reveals.

## Generation scaffold

`scripts/nft/generate_bags.ts` deterministically emits `nft/bags/<index>.json`
for a configurable collection size and tier split, plus
`nft/collection_manifest.json`. It is the single source of truth for the loot
math and should be mirrored by the on-chain `open_bag` instruction so off-chain
previews match on-chain reality.
