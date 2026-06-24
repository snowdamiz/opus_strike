# Paid Hero Skins Plan

## Reader And Goal

Reader: an engineer implementing paid cosmetics in Slop Heroes.

Post-read action: convert hero visuals from hero-only hard-coded models into a skin catalog, then ship the first paid Phantom skin that can be purchased with the game's SPL token after the token mint is launched.

## Current State

- Gameplay identity is `heroId`. It drives hero stats, abilities, hitboxes, party hero locks, matchmaking tickets, room state, and rendering.
- Full-body voxel bodies and first-person viewmodels are keyed directly by hero id.
- Shared model documents already validate full-body parts, material palettes, sockets, pose channels, and viewmodel descriptors. This is the right base for a skin-aware catalog.
- The lobby has a `loadout` tab placeholder, and hero preview surfaces already render hero bodies in reusable canvases.
- The server already has wallet identity, ranked SPL-token holding checks, SOL wager payment intents, signed transaction submission, memo verification, and confirmed transaction parsing.
- There is no cosmetics ownership, purchase ledger, or selected skin persistence yet.

## Design Principles

- Keep gameplay and cosmetics separate. A skin must never change stats, movement, ability damage, hitboxes, cooldowns, matchmaking hero locks, or anti-cheat expectations.
- Treat every current hero model as a default skin. The default skin should use the same resolver path as paid skins so legacy hero-only rendering can be removed.
- Store token prices in base units, not UI floats. The token mint, decimals, symbol, treasury wallet, and cluster are launch configuration.
- Let admins change skin prices from the admin panel without a deploy. Runtime price changes apply to new purchase intents immediately.
- Verify purchases server-side from confirmed on-chain data. Client state can request and display purchases, but ownership only comes from the server ledger.
- Keep model sockets compatible with the base hero ability kit. A Phantom skin must still expose Phantom palm and void-ray sockets for first-person and remote effects.
- Remove direct hero-to-model hard-coding once the resolver is in place.

## Target Architecture

### Shared Skin Catalog

Add shared types for:

- `HeroSkinId`: stable cosmetic id, such as `phantom.default` and `phantom.void-monarch`.
- `HeroSkinDefinition`: skin id, hero id, display name, rarity, availability, pricing, release state, and model document id.
- `HeroSkinEntitlement`: `free`, `paid`, `admin_grant`, or future event/source tags.
- `HeroSkinPrice`: SPL mint address, token symbol, amount in base units, and optional launch-disabled state.

Add a catalog that includes all existing default skins:

- `phantom.default`
- `hookshot.default`
- `blaze.default`
- `chronos.default`

Then add the first paid skin:

- `phantom.void-monarch`

The catalog should validate:

- Every hero has exactly one default skin.
- Paid skins have a non-empty price object or an explicit `purchaseDisabledReason`.
- Skin model documents match their owning hero.
- Skin ids are stable, unique, lowercase, and never derived from display names at runtime.

### Model Resolution

Add a single model resolver:

```ts
resolveHeroSkinModel(heroId, requestedSkinId)
```

Rules:

- If the requested skin is valid for the hero, return that skin.
- If it is missing, locked, or mismatched, return the hero's default skin.
- Do not let invalid skin ids crash rendering in live rooms.
- Emit a development warning when fallback happens so bad data is easy to catch.

Refactor renderers to consume resolved skin models:

- Full-body hero renderer receives `heroId` plus `skinId`.
- First-person viewmodel receives `heroId` plus `skinId`.
- Hero preview receives `heroId` plus optional `skinId`.
- Remote batch rendering groups by skin id, not only by hero id, because geometry and materials can differ per skin.
- GPU prewarm includes every default skin and any locally owned paid skins.

Once this works, remove direct render-time indexing into hero-only body and viewmodel manifests.

### Persistence

Add server-side persistence for cosmetics:

- `SkinShopSettings`: admin-managed row for active token mint, token symbol, treasury wallet, cluster, and shop enabled flag.
- `SkinShopItemSettings`: admin-managed per-skin row for sale status, token amount base units, price version, updated by, and updated at.
- `UserSkinOwnership`: user id, skin id, source, purchase id, granted at, revoked at.
- `SkinPurchaseIntent`: user id, wallet address, skin id, quoted price version, token mint, token amount base units, treasury token account, memo, status, transaction signature, expiration, credited at, last error.
- `UserHeroLoadout`: user id, hero id, selected skin id.

Ownership and loadouts should be unique by user and skin/hero. A purchase can be retried safely without duplicating ownership. Price settings are mutable, but purchase intents are immutable quotes once created.

### API Surface

Add authenticated endpoints for:

- Read catalog with ownership and selected skin state.
- Read and update loadout for a hero.
- Create a skin purchase intent.
- Build a purchase transaction for the wallet to sign.
- Submit a signed transaction or transaction signature.
- Poll purchase status.

Add admin-only endpoints for:

- Read and update global shop token settings.
- Read and update each paid skin's token price in base units.
- Enable or disable purchase availability per skin.
- View audit metadata for the last price/status change.

Expected behavior:

- Anonymous users can view catalog metadata, but purchase and equip require auth.
- Purchasing requires a linked Solana wallet.
- Equipping a paid skin requires ownership.
- A party launch or game join should revalidate selected skins and fall back to default if ownership is missing.
- Admin price changes affect catalog responses and newly created purchase intents immediately.
- Existing purchase intents keep the quoted token amount, mint, treasury account, and expiration they were created with.
- Disabling a skin for purchase blocks new intents but does not revoke existing ownership.

### Admin Price Controls

The admin panel should expose a small skin-shop editor:

- Global shop controls: enabled flag, token mint, token symbol, cluster, treasury wallet, and RPC status.
- Per-skin controls: sale enabled flag, token amount in base units, optional display note, and last-updated metadata.
- Price preview: render the human-readable amount from the configured mint decimals, but store and submit only base units.
- Validation: paid skin id must exist, amount must be a positive integer when sale is enabled, token config must be complete, and default/free skins cannot be priced.
- Audit: record `updatedByUserId`, `updatedAt`, old amount, new amount, old sale status, and new sale status.
- Concurrency: use an optimistic `priceVersion` so the admin UI can detect stale edits.

### SPL Token Purchase Flow

Because the token has not launched yet, ship the plumbing behind disabled launch config:

- `SKIN_SHOP_ENABLED`
- `SKIN_SHOP_TOKEN_MINT`
- `SKIN_SHOP_TOKEN_SYMBOL`
- `SKIN_SHOP_TREASURY_WALLET`
- `SKIN_SHOP_RPC_URL`
- `SKIN_SHOP_CLUSTER`

Payment flow:

1. Server reads the current admin-configured skin price and creates an immutable intent with a memo like `opus-skin:<intentId>`.
2. Server builds a transaction that transfers the exact SPL token amount from the user's associated token account to the treasury associated token account.
3. If the treasury associated token account may not exist, include an idempotent create-associated-token-account instruction.
4. Use `TransferChecked` so the transaction binds the mint and decimals.
5. Include a fresh blockhash and store `lastValidBlockHeight` on the intent.
6. Client shows a transaction summary with wallet, skin, amount, token, treasury destination, cluster, and network fee context.
7. Client simulates before asking the wallet to sign.
8. Wallet signs and sends, or signs and returns the transaction for server submission.
9. Server verifies the confirmed transaction:
   - transaction exists and did not fail
   - linked wallet signed
   - memo matches the intent
   - transfer uses the configured mint
   - destination is the treasury token account
   - amount is at least the intent amount
   - block time is inside the intent window plus grace period
   - signature has not been credited before
10. Server marks ownership granted and purchase credited in one database transaction.

The current server already has useful SOL payment intent and verification patterns. Reuse the shape, but move shared parsing into a token-payment helper instead of copying wager-specific logic.

## First Paid Skin

### Catalog Entry

```ts
{
  id: 'phantom.void-monarch',
  heroId: 'phantom',
  displayName: 'Void Monarch',
  subtitle: 'A royal void-forged Phantom frame with crownlit armor and colder first-person gauntlets.',
  rarity: 'epic',
  availability: 'paid',
  releaseState: 'ready_when_token_launches',
  price: {
    tokenSymbol: 'TOKEN',
    tokenMintAddress: null,
    amountBaseUnits: null,
    adminEditable: true,
    disabledReason: 'Game SPL token has not launched yet'
  }
}
```

Final price should be set in the admin panel after the mint decimals and token economy are final. Seed this item as purchase-disabled with no amount until token launch config is complete.

### Visual Direction

Full body:

- Obsidian and deep violet armor replacing the base Phantom purple plates.
- Crown-like angular head crest using small voxel plates.
- Brighter eye slit with pale violet-white glow.
- Thin royal trim on shoulders, chest, wrists, and shin guards.
- Darker mist floor ring with a slightly colder glow.
- Team accents remain separate and readable.

First person:

- Both forearms use darker armor, silver-violet metal knuckles, and pale void glow.
- Void-ray orb becomes a brighter crystalline core with a translucent outer shell.
- Existing Phantom pose channels and sockets remain unchanged.

Material palette:

- `armor`: `#171127`
- `dark`: `#05030a`
- `metal`: `#3d3557`
- `accent`: `#8b5cf6`
- `glow`: `#e9d5ff`
- `glass`: `#32224e`
- `skin`: `#160d22`
- `void`: `#010006`
- `edge`: `#6d5a9b`
- `eye`: `#fff7ff`
- `mist`: `#7c3aed`

Implementation approach:

- Start as a variant of the Phantom default skin.
- Override the material palette.
- Add a small number of extra full-body parts for crest, shoulder trim, chest trim, wrist trim, shin trim, and mist ring.
- Add a small number of viewmodel parts for knuckle caps and crystalline orb shell.
- Keep every existing Phantom socket name and pose channel.

## Implementation Slices

### Slice 1: Shared Catalog And Types

- Add skin ids, skin definitions, pricing types, ownership/loadout DTOs, and catalog validation.
- Register default skins for every existing hero.
- Register `phantom.void-monarch` as paid but purchase-disabled until token launch config is present.
- Add tests for catalog validation and fallback behavior.

### Slice 2: Skin-Aware Model Documents

- Introduce skin model documents and a resolver that returns a full-body plus viewmodel document.
- Move existing hero manifests behind default skin entries.
- Add Phantom Void Monarch body and viewmodel variant data.
- Run model document validation for every skin.
- Remove render-facing direct access to hero-only manifest maps after all callers use the resolver.

### Slice 3: Client Rendering Conversion

- Pass selected skin id through hero preview, full-body render, first-person viewmodel, ragdoll/death visuals, and batched remote rendering.
- Update material caches to key by skin id.
- Update batch renderer grouping so different skins do not share incompatible instanced geometry/material buffers.
- Keep ability effect sockets resolved by socket name, not by skin-specific part ids.

### Slice 4: Server Ownership And Loadout

- Add persistence for ownership, loadouts, and purchase intents.
- Add authenticated catalog/loadout endpoints.
- Validate equipped skin ownership when updating loadout.
- Add selected skin to party member state, matchmaking launch payloads, room auth context, player schema, and replication state.
- Fall back to default skin for bots and for invalid or unowned selections.

### Slice 5: Admin Skin Pricing

- Extend the admin panel with global shop controls and per-skin price controls.
- Add admin-only endpoints for updating paid skin sale status and token amount base units.
- Persist price version and audit metadata for every admin price/status change.
- Ensure catalog reads merge static skin metadata with admin-managed price state.
- Ensure creating a purchase intent snapshots the current price version and token amount.
- Add tests for price validation, stale price version rejection, disabled purchases, and immutable existing intents after an admin price change.

### Slice 6: SPL Token Purchase Plumbing

- Add shop config and disabled-state responses while the token mint is unknown.
- Build SPL token purchase intents with memo, amount base units, token mint, treasury token account, expiration, and status.
- Add token-program helper dependencies only where transaction building/verification needs them.
- Build wallet-signable token transfer transactions.
- Verify confirmed token transfers and grant ownership idempotently.
- Add tests with parsed transaction fixtures for success, wrong memo, wrong mint, wrong recipient, underpayment, expired intent, duplicate signature, and missing signer.

### Slice 7: Loadout And Shop UI

- Replace the `loadout` placeholder with a dense hero skin selector.
- Show owned, equipped, locked, and purchase-disabled states.
- Let users preview owned and locked skins before purchase.
- Use the same preview canvas with `skinId`.
- Add purchase flow UI that shows token amount, treasury destination, cluster, wallet, and pending/confirmed/failed states.

### Slice 8: Cleanup And Verification

- Remove legacy hero-only visual entry points that are no longer needed.
- Confirm all current heroes still render through their default skin.
- Confirm Phantom Void Monarch renders in preview, remote body, local viewmodel, and party/lobby selection.
- Confirm invalid skin ids never crash clients and always fall back to default.
- Confirm paid skin ownership cannot be forged from client state.

## Verification Commands

Do not use browser testing for this work. Use command-line verification:

```bash
pnpm --filter @voxel-strike/shared test:model-system
pnpm --filter @voxel-strike/client test:model-system
pnpm --filter @voxel-strike/client test
pnpm --filter @voxel-strike/server test
pnpm typecheck
```

Add narrower scripts if the full test suite is too slow during iteration.

## Open Decisions

- Final SPL token mint address, symbol, decimals, treasury wallet, and cluster.
- Final Void Monarch price in token base units.
- Which admin roles are allowed to edit skin prices and whether price changes require a second confirmation.
- Whether shop purchases are permanent account entitlements only, or whether future skins should also support NFT receipts.
- Refund policy for accidental duplicate payments or overpayments.
- Whether Token-2022 extensions will be used. If yes, verify transfer-fee and frozen-account behavior before launch.
- Whether bots can use paid skins in non-production/dev rooms for visual testing.

## External References Checked

- Solana associated token accounts: https://solana.com/docs/tokens/basics/create-token-account
- Solana token transfers and `TransferChecked`: https://solana.com/docs/tokens/basics/transfer-tokens
- Solana transaction simulation RPC: https://solana.com/docs/rpc/http/simulatetransaction
- Solana production payment readiness and blockhash handling: https://solana.com/docs/payments/production-readiness

## Launch Checklist

- Token mint and treasury wallet configured.
- Admin panel can update paid skin prices without deploys.
- Price updates are visible in catalog responses and apply only to new purchase intents.
- Shop enabled only after token transfer verification passes on the target cluster.
- Catalog exposes Phantom Void Monarch as purchasable.
- Loadout persists and rehydrates across sessions.
- Room state replicates selected skin ids.
- Paid skin falls back safely when ownership or catalog data is unavailable.
- Direct hero-only model paths are removed from rendering code.
