# Skin NFT Plan

Last checked: 2026-06-27

Reader: an internal engineer implementing NFT-backed cosmetics for Opus Strike.

Post-read action: implement the base NFT-skin path without changing the pump.fun game-token constraint.

## Decision

Skins should become Solana NFTs, while the game token remains the payment and token-gating asset. The game token will be deployed on pump.fun and configured as the single global SPL token mint after launch.

Use Metaplex Core for the first NFT implementation. Core is the preferred default because it is the current Metaplex NFT standard for new Solana projects, has lower mint cost than legacy Token Metadata NFTs, supports collections, and supports plugins for attributes, royalties, freezes, delegates, and other lifecycle behavior.

Use compressed NFTs later only if skin supply grows into very large free drops or loot-style distributions. Bubblegum V2 is built for lower-cost mass minting, but it adds more indexing and verification dependencies than the base path needs.

## Source Notes

- Metaplex Core overview: https://www.metaplex.com/docs/smart-contracts/core
- Metaplex Core plugins: https://www.metaplex.com/docs/smart-contracts/core/plugins
- Metaplex DAS API overview: https://www.metaplex.com/docs/dev-tools/das-api
- DAS `getAssetsByOwner`: https://www.metaplex.com/docs/dev-tools/das-api/methods/get-assets-by-owner
- Metaplex Bubblegum V2 overview: https://www.metaplex.com/docs/smart-contracts/bubblegum-v2
- pump.fun fee docs: https://pump.fun/docs/fees

## Existing Product Shape

The game already has most of the non-chain scaffolding:

- A stable shared skin catalog with hero, rarity, price, release-state, and availability metadata.
- Server-side skin shop settings, per-skin price/supply settings, purchase intents, user ownership rows, and hero loadout rows.
- A wallet authentication flow and wallet transaction signing path.
- A payment flow that builds an SPL-token transfer transaction, simulates it, collects a wallet signature, submits it, verifies memo/recipient/mint/amount, then credits the skin.
- A global game-token config that already makes the skin shop read the one configured game token instead of feature-specific token rows.

The NFT plan should preserve that shape. The major change is that paid and earned skin access becomes wallet-asset ownership, not just account-granted database ownership.

## Base Architecture

Create one Metaplex Core collection for all Opus Strike skins.

Mint one Core asset for each owned skin copy. The asset owner is the player's linked Solana wallet. The asset metadata identifies the skin using a stable `skinId` that maps back to the shared skin catalog. The game never trusts NFT metadata to define gameplay models; it only uses the NFT to prove ownership of a known catalog entry.

Keep the database as a fast projection:

- The wallet owns the canonical NFT.
- The server syncs verified wallet assets into cached entitlement rows.
- Loadout selection uses the cached rows after they have been refreshed or confirmed.
- If an NFT transfers away, the next sync revokes cached access and stored loadouts fall back to the hero default.

## NFT Metadata Contract

Each Core asset should include:

- Collection: the verified Opus Strike Skins collection.
- Name: player-facing skin name plus optional serial.
- URI: off-chain JSON metadata for image, description, attributes, and project links.
- Attributes:
  - `skinId`
  - `heroId`
  - `rarity`
  - `season`
  - `edition`
  - `serial`
  - `source`

The authoritative mapping from `skinId` to renderable model remains the shared skin catalog. If metadata says `skinId=made.up.skin`, the server ignores it because it is not in the known catalog.

## Ownership Rules

Default skins stay free and never need NFTs.

Paid skins should require a verified NFT from the Opus Strike collection in the linked wallet.

Earned founder skins need a product decision:

- Tradable founder skins: mint normal Core assets and let access follow transfers.
- Account-bound founder skins: use a non-transferable policy, or keep founder rewards off-chain until a later soulbound implementation is chosen.

The first implementation should support tradable paid skins and leave founder NFT behavior behind a separate launch switch.

## Purchase And Mint Flow

The first version should keep the existing server-verified payment flow and add NFT minting after payment verification.

1. Player clicks buy in the Skins UI.
2. Server creates a purchase intent for the selected skin.
3. Server builds an SPL-token payment transaction using the configured game token mint.
4. Client simulates, signs, and submits the transaction through the connected wallet.
5. Server verifies the submitted transaction:
   - signer is the linked wallet
   - memo matches the intent
   - mint matches the configured game token
   - destination is the treasury token account
   - amount is at least the quoted price
   - transaction is within the intent window
6. Server mints a Core asset to the linked wallet.
7. Server records the minted asset address on the purchase intent.
8. Server syncs or upserts the cached entitlement row with source `nft`.
9. Server marks the purchase credited.
10. Client refreshes the catalog and may equip the skin.

This is not fully atomic across token payment and NFT minting, so the service must be retry-safe. If payment is confirmed but minting fails, the intent should move to a retryable mint-pending state rather than failed ownership.

## Ownership Sync

Add a server-side NFT ownership sync service.

Inputs:

- User id
- Linked wallet address
- Target collection address
- Known skin catalog ids

Process:

1. Query wallet assets with a DAS-capable RPC.
2. Filter to assets in the verified Opus Strike collection.
3. Extract trusted attributes, especially `skinId`.
4. Reject unknown or disabled skins.
5. Upsert active cached entitlements for owned NFT-backed skins.
6. Revoke cached NFT entitlements that no longer appear in the wallet.
7. Re-resolve stored loadouts so missing skins fall back safely.

Run the sync:

- On catalog load for authenticated users, with a short cache window.
- After a purchase mints an NFT.
- After wallet link or wallet change.
- From an admin/manual refresh endpoint.
- From a background job for stale entitlements, if needed.

## Database Changes

Add NFT-specific state without removing the existing shop concepts.

Suggested additions:

- Add `nft` to skin entitlement sources.
- Add minting states to purchase intents, or add a separate NFT mint status.
- Store minted asset address, collection address, metadata URI, mint signature, mint error, and last mint attempt.
- Add an NFT asset projection table keyed by asset address.
- Track owner wallet, skin id, collection address, source purchase id, first seen time, last synced time, and revoked time.
- Preserve price, supply cap, and audit tables because those still control sale setup.

Avoid making `userId + skinId` the only representation of ownership for NFTs. One wallet may hold multiple copies of the same skin, and later features may care about serials, editions, resale, or rentals.

## Server Changes

Add a small NFT module with these responsibilities:

- Create or load the project collection address from environment/config.
- Mint a Core asset to a wallet after payment confirmation.
- Parse and validate DAS assets.
- Sync wallet ownership into database projections.
- Expose admin diagnostics for collection address, RPC/DAS readiness, mint authority readiness, and failed mint retries.

Update the skin shop service:

- Treat paid skins as NFT-backed when the collection is configured.
- After verified payment, call the NFT mint service before final credit.
- Make purchase crediting idempotent when the NFT already exists for an intent.
- Update ownership checks to accept default skins plus verified active NFT entitlements.
- Keep admin grants/event grants distinct from NFT entitlements.

Update loadout resolution:

- Resolve the requested skin against active entitlements.
- If a stored loadout points to an NFT no longer in the wallet, fall back to the default skin and leave a clear reason in logs.

## Client Changes

Keep the current buy/equip flow, but rename the user-facing concept from purchase-only ownership to wallet asset ownership.

Add UI states for:

- Syncing wallet skins.
- Payment confirmed, mint pending.
- Mint retry needed.
- NFT owned.
- NFT missing from linked wallet.

Avoid asking the client to prove ownership. The client can request refreshes, but the server owns verification.

## Admin Changes

Extend the economy or skin-shop admin surface with:

- NFT mode enabled/disabled.
- Collection address.
- Mint authority configured status.
- DAS RPC configured status.
- Per-skin metadata URI template or override.
- Failed mint retry queue.
- Asset count by skin.
- Wallet sync status and last sync time for a user.

Skin price and supply cap editing should remain where it is. The NFT layer changes delivery and ownership proof, not the token used for payment.

## Implementation Phases

### Phase 1: Data Model And Config

- Add NFT config for collection address, mint authority public key, metadata base URI, and DAS RPC readiness.
- Add database fields/tables for NFT mint status and asset projections.
- Add `nft` entitlement source.
- Add migrations and focused service tests.

Exit criteria:

- Existing non-NFT skin shop behavior still passes tests.
- NFT-backed rows can be represented without minting anything.

### Phase 2: NFT Verification Projection

- Implement DAS ownership sync.
- Verify collection membership and known `skinId`.
- Upsert and revoke cached NFT entitlements.
- Integrate sync into catalog load behind a feature flag.

Exit criteria:

- Given mocked DAS assets, the catalog marks only verified known skins as owned.
- Transferred-away assets revoke access and loadouts fall back.

### Phase 3: Mint After Payment

- Implement Core asset minting to the linked wallet.
- Extend purchase crediting with mint-pending and retry-safe behavior.
- Store asset address and mint signature.
- Add admin retry for failed mints.

Exit criteria:

- A confirmed token payment results in one minted NFT and one active entitlement.
- Re-running crediting does not double-mint.
- Payment-confirmed/mint-failed cases are recoverable.

### Phase 4: Client And Admin Polish

- Update Skins UI labels and status messages.
- Add wallet sync feedback.
- Add admin diagnostics and retry actions.
- Add operational logging for mint and sync failures.

Exit criteria:

- Players understand whether they need to pay, wait for minting, sync, or connect the wallet holding the NFT.
- Operators can identify and retry failed delivery without database surgery.

### Phase 5: Mainnet Launch

- Deploy the pump.fun game token.
- Configure `GAME_TOKEN_MINT`, `GAME_TOKEN_SYMBOL`, `SOLANA_CLUSTER`, and `SOLANA_RPC_URL`.
- Create the Core collection on the launch cluster.
- Configure collection and mint authority secrets in production.
- Upload immutable metadata assets.
- Run a small allowlisted paid mint on mainnet.
- Enable public skin sales.

Exit criteria:

- The live catalog prices in the pump.fun-launched game token.
- A real purchase mints a verified collection asset to the buyer wallet.
- Reloading after transfer changes access according to the new owner.

## Security And Abuse Notes

- Never trust NFT names, images, or off-chain metadata as authority. Only trusted collection membership plus a known `skinId` grants access.
- Treat RPC/DAS responses as untrusted input. Validate owners, collection, asset standard, and attributes.
- Do not accept client-submitted asset ids as proof without server verification.
- Do not sign or send mainnet mint transactions from development tooling without explicit operator confirmation.
- Keep mint authority keys out of source control and out of client bundles.
- Make payment-confirmed/mint-pending recoverable so users cannot pay and lose delivery because of an RPC outage.

## Open Decisions

- Should paid skin NFTs be tradable at launch?
- Should founder skins become NFTs, and if so, should they be tradable or account-bound?
- Should supply caps count minted NFTs, credited purchase intents, or both during migration?
- Should metadata be immutable immediately, or mutable until art and naming are final?
- Which DAS-capable RPC provider will production use?
- Should the first collection use one shared collection or separate collections by season?

## Out Of Scope For The Base Path

- Custom on-chain sale program.
- Atomic token payment plus NFT mint in one program instruction.
- In-game secondary marketplace.
- Rental/delegation support.
- Compressed NFT drops.
- Token-2022 extensions for the pump.fun game token.

## Reader Test

A fresh engineer should be able to start with the base path by implementing the data/config phase, then the DAS sync projection, then mint-after-payment. The key invariants are explicit: the pump.fun token remains the payment token, Metaplex Core assets are the skin ownership proof, and the database is a projection rather than the source of truth for NFT-backed skins.
