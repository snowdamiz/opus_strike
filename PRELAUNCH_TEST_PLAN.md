# Prelaunch No-Spend Test Plan

## Reader And Goal

Reader: the launch owner or engineer responsible for deciding whether the economy, cosmetics, ranked access, rewards, and related launch-critical flows are safe to turn on.

Post-read action: run this plan locally, collect the listed evidence, and make a launch/no-launch call without deploying a mainnet token and without spending money.

## Non-Negotiables

- Do not use `mainnet-beta` for launch rehearsal.
- Do not use a real treasury wallet, real user wallet, or real paid token.
- Do not send value-bearing transactions.
- Keep chain-facing tests on mocked RPC responses, a local Solana validator, or devnet faucet assets only.
- Browser/UI verification is a manual launch-owner pass. The automated part of this plan should use scripts, API calls, database assertions, and local services.
- Treat any failed payment/reward/ownership idempotency check as a launch blocker.

## Code Context Checked

The current code has these launch-critical surfaces:

- Paid skin shop: catalog visibility, admin pricing, supply caps, purchase intents, SPL token payment transaction build/simulation/submission, memo-based verification, and ownership crediting.
- Loadouts: owned/free skin equip, hidden skin fallback, match ticket skin resolution, party skin propagation.
- Global game token config: one token identity feeds skin purchases, ranked token gate, and game-token mission payouts.
- Ranked entry gate: locked by default, token-required mode after game-token config, SPL balance checks, short status cache.
- Ranked founder rewards: limited golden skin set for early ranked players, cap and idempotency protections.
- Player rewards: ranked drip, objective bounty, manual season-end top-10 payouts, treasury reserve, payout grouping, and retry/failure states.
- Daily missions: criteria validation, UTC reset, match contribution, SOL ledger rewards, game-token payouts, skin rewards, and admin overview counts.
- Wagers and golden biome rewards: native SOL wager deposits, refunds, settlement math, treasury transfer retries, and golden reward distribution.
- Admin console APIs: reward economy settings, ranked gate settings, mission CRUD, skin shop settings, per-skin pricing/supply, and CSRF-protected mutations.

## Test Environments

Use three environments. Only the third touches a Solana node, and it should be local by default.

| Environment | Purpose | Cost | Chain Risk |
| --- | --- | --- | --- |
| Mocked/off-chain | Fast coverage for parsing, pricing, idempotency, eligibility, status transitions, and DB writes | Free | None |
| Local app stack | Real Postgres/Redis, API routes, Prisma migrations, background jobs disabled or controlled | Free | None unless RPC env is set |
| Local validator | End-to-end SPL/SOL transaction rehearsal using local airdrops and local token mint | Free | Local only |

Optional: devnet can be used for wallet UX rehearsal with faucet assets, but only after the local validator pass is green. Devnet is not required to launch-test the server logic.

## Baseline Setup

Use a clean local database for the full plan.

```bash
pnpm install
pnpm db:up
pnpm --filter @voxel-strike/server db:migrate
pnpm --filter @voxel-strike/server db:generate
```

Use safe no-chain defaults for the first pass:

```bash
unset GAME_TOKEN_MINT
unset SKIN_SHOP_TOKEN_MINT
unset SOLANA_RPC_URL
unset RANKED_TOKEN_HOLD_RPC_URL
unset WAGER_TREASURY_WALLET
unset WAGER_SETTLEMENT_SECRET_KEY
unset WAGER_SETTLEMENT_SIGNER_SECRET
export SOLANA_CLUSTER=localnet
export SKIN_SHOP_ENABLED=false
export WAGER_SOL_ENABLED=false
export PLAYER_REWARDS_ENABLED=false
```

Use this safe shell for mocked/off-chain and local app-stack checks. When moving to local-validator checks, open a new shell or explicitly reset the environment before starting the server so local token settings do not leak backward into the no-chain pass.

## Automated Existing Coverage

Run these in the safe no-chain environment before any manual or local-validator work:

```bash
pnpm test:prelaunch:no-chain
```

Or run the same coverage command-by-command:

```bash
pnpm typecheck
pnpm build
pnpm --filter @voxel-strike/server test:skin-token-payments
pnpm --filter @voxel-strike/server test:skin-purchase-lifecycle
pnpm --filter @voxel-strike/server test:skin-shop
pnpm --filter @voxel-strike/server test:skin-founder
pnpm --filter @voxel-strike/server test:ranked-token-hold
pnpm --filter @voxel-strike/server test:player-rewards
pnpm --filter @voxel-strike/server test:daily-missions
pnpm --filter @voxel-strike/server test:wager
pnpm --filter @voxel-strike/server test:match-finalization
pnpm --filter @voxel-strike/server test:persistence
pnpm --filter @voxel-strike/server test:matchmaking
pnpm --filter @voxel-strike/server test:matchmaking-settings
pnpm --filter @voxel-strike/server test:ranking
pnpm --filter @voxel-strike/server test:auth
pnpm --filter @voxel-strike/server test:authority
pnpm --filter @voxel-strike/server test:anticheat
pnpm --filter @voxel-strike/shared test:model-system
pnpm --filter @voxel-strike/shared test:model-sockets
pnpm --filter @voxel-strike/shared test:damage
pnpm --filter @voxel-strike/physics test:movement
pnpm --filter @voxel-strike/client test:model-system
pnpm --filter @voxel-strike/client test:movement
pnpm --filter @voxel-strike/client test:visual-store
```

Evidence to save:

- Full command output.
- Any failing command, failing assertion, and environment variables used.
- Confirmation that no chain-facing command used `mainnet-beta` or a mainnet RPC.

## Local App-Stack API Pass

After the existing script checks are green, start the local app stack with the same safe no-chain defaults and exercise API routes against Postgres/Redis-backed state.

Pass criteria:

- Server starts with shop, wagers, and payouts disabled instead of crashing on missing token/RPC/signer config.
- Public economy and cosmetics reads return safe disabled/locked states.
- Auth-required routes reject anonymous requests.
- Admin routes reject missing admin auth and missing CSRF.
- Admin overview loads with game token unset and clearly reports token-gated features as unavailable.
- Creating disabled/off-chain mission definitions, skin shop item settings, and reward economy settings writes the expected rows without any chain call.

## Paid Skin Purchase Gates

### Catalog And Admin Configuration

Pass criteria:

- With shop disabled, paid skins are absent from public catalog while free/default skins remain available.
- Unlockable founder skins are previewable when release state allows, but never purchasable.
- With shop enabled but missing game token, RPC, treasury wallet, sale flag, or price, paid skins show a disabled purchase reason.
- Per-skin admin update rejects default skins, zero/invalid price, invalid supply cap, and stale price version.
- Per-skin admin update records price version increment and audit metadata.
- Supply labels and purchase-disabled state reflect sold plus active reserved counts.

Add or run API-level checks for:

- `401` when unauthenticated users mutate loadouts or create purchase intents.
- `400` for invalid skin id, wrong hero/skin pairing, and missing linked wallet.
- `409` for already-owned paid skin and stale admin price version.

### Intent Lifecycle

Create a paid skin with a small supply cap in local DB and exercise these states:

| Case | Expected Result |
| --- | --- |
| New valid intent | `intent_created`, price snapshot, memo begins with the skin memo prefix, expiry set |
| Build transaction | `transaction_built`, treasury token account saved, last valid block height saved |
| Intent expires before build/status poll | `expired` with `intent_expired` |
| Intent already credited | further build/submit attempts return conflict |
| Duplicate transaction signature across intents | rejected |
| Concurrent purchases at max supply | exactly supply cap credits; all others fail or remain uncredited |
| Payment arrives after supply sells out | no ownership grant; intent fails with sold-out conflict |

Database assertions:

- `skinPurchaseIntent` preserves the quoted price, token mint, token symbol, token decimals, treasury wallet, memo, and wallet address from intent creation.
- `userSkinOwnership` is created once with source `paid` and purchase id after credit.
- Revoked ownership can be restored only through a valid credit or explicit event/admin path.

### Payment Verification Negative Matrix

Use parsed transaction fixtures or mocked RPC responses. Each case must fail before ownership credit:

- Transaction not found.
- Transaction has on-chain error.
- Missing wallet signer.
- Missing memo.
- Wrong memo.
- Missing transfer.
- Wrong SPL mint.
- Wrong recipient token account.
- Wrong transfer authority.
- Underpayment.
- Transaction block time before intent creation.
- Transaction block time after intent expiry plus grace.
- Unparseable signed transaction payload.
- Signed transaction fee payer does not match linked wallet.
- Signed transaction memo does not match intent.
- Signed transaction is missing payer signature.

### Local Validator Skin Purchase Rehearsal

Only run after the mocked/off-chain pass is green.

Use a local validator with a temporary mint:

- Start a local validator.
- Create a local test mint.
- Mint local test tokens to the test buyer wallet.
- Create or fund the local treasury token account.
- Set:

```bash
export SOLANA_CLUSTER=localnet
export SOLANA_RPC_URL=http://127.0.0.1:8899
export GAME_TOKEN_MINT=<local test mint>
export GAME_TOKEN_SYMBOL=TEST
export WAGER_TREASURY_WALLET=<local treasury wallet>
export SKIN_SHOP_ENABLED=true
```

Pass criteria:

- Server builds a transaction with ATA creation, SPL `transferChecked`, and skin memo.
- Simulation succeeds.
- Signed local transaction submits and confirms.
- Intent reaches `credited`.
- Catalog reload shows the skin owned and equipped after loadout update.
- Treasury token account receives the exact local token amount.
- No mainnet RPC endpoint is used.

## Loadout And Match Entry Gates

Pass criteria:

- Free/default skin can always be equipped.
- Paid skin cannot be equipped before ownership.
- Paid skin can be equipped after paid or event ownership.
- Hidden paid skin in saved loadout falls back to default.
- Wrong-hero skin selection is rejected.
- Revoked skin is not treated as owned.
- Quick play and ranked ticket creation resolve selected skin through server ownership checks, not just client state.
- Party member selected skin updates when the local authenticated user equips a skin.

Manual browser pass for launch owner:

- Login required state.
- Wallet linking prompt.
- Wallet mismatch error.
- Wallet without `signTransaction` support error.
- Purchase disabled reasons.
- Sold-out label.
- Owned/equipped labels.
- Retry after pending submitted intent.

## Ranked Token Gate

Pass criteria:

- Default mode is locked and returns an ineligible locked status.
- Admin cannot enable token-required mode unless the global game token mint is configured.
- Required token amount must be a positive whole number in token-required mode.
- Missing wallet returns an explicit ranked wallet error.
- Missing RPC returns a service unavailable error.
- Invalid wallet address returns a client error.
- SPL token account balances across all accounts for the mint are summed.
- Required whole-token amount converts to base units using mint decimals.
- Eligible and ineligible balances return correct status payloads.
- Status cache respects configured TTL and clears after admin gate changes.

Run the mocked balance checks first. In local-validator mode, mint the local token to one wallet above the threshold and leave another below it.

## Ranked Founder Rewards

Pass criteria:

- Golden founder set includes one unlockable golden skin for every hero.
- A fresh first-ranked-match player claims exactly one founder slot and receives the full set.
- A player who already owns any founder skin does not burn another slot.
- The max-claims cap is never exceeded under repeated or concurrent grant attempts.
- Founder grant is atomic with ranked match persistence.
- Catalog shows founder skins as event entitlements after grant.
- Loadout equip succeeds for granted founder skins and fails for non-granted users.

## Player Rewards

### Match Rewards

Pass criteria:

- Rewards are created only for ranked, ranked-eligible, clean-integrity matches.
- Rewards are skipped when anti-cheat requires review, ranked hold is required, match is too short, or participant left early.
- Daily ranked drip respects per-user daily max.
- Objective bounty includes win, flag capture, flag return, and assist amounts.
- Per-player cap and whole-match cap are enforced.
- Treasury reserve can reduce or block reward creation without negative balances.
- Idempotency keys prevent duplicate rewards on repeated match finalization.

Database assertions:

- `playerReward.kind` is one of the expected launch reward kinds.
- `amountLamports`, `reason`, `matchId`, `playerSessionId`, and metadata match the finalized match.
- Duplicate finalization returns duplicate/no-op behavior, not extra rewards.

### Payouts

No-money baseline:

- Run with no settlement signer and verify pending rewards are not paid.
- Run with invalid user wallet and verify payout is skipped without corrupting pending rewards.

Local-validator rehearsal:

- Use a local settlement signer funded by local airdrop.
- Pay grouped rewards to a local recipient wallet.
- Confirm payout rows move `pending -> submitted -> confirmed`.
- Confirm reward rows move `pending -> processing -> paid`.
- Force a failure before submission and confirm rewards return to `pending`.
- Force a failure after submission and confirm rewards become `failed` for manual review.

### Manual Season-End Top 10

Pass criteria:

- Manual admin action accepts the season number and per-player payout amount.
- Payout selects the ranked season leaderboard top 10 by the same ordering players see: competitive rating, ranked wins, fewer ranked games, then earlier update time.
- Each selected player receives exactly the chosen per-player amount.
- Payout creates `season_top_10` reward rows with idempotency keys scoped to mode, season number, and user.
- Re-running the same season payout is a no-op and cannot double-pay.
- The action refuses to settle if the treasury budget cannot cover the full top-10 obligation.
- The payout can target an archived previous season as long as that season number is supplied.

## Daily Missions

### Admin Validation

Pass criteria:

- Mission name, dates, sort order, criteria, rewards, and eligibility reject invalid values.
- Active end must be after active start.
- Criteria require unique ids and valid hero/ability fields.
- Reward bundle supports at most one SOL reward, one game-token reward, and unique skin rewards.
- Skin reward id must exist in the skin catalog.
- Eligibility defaults are applied when omitted.
- Archived missions stop appearing in active player missions.

### Progression And Grants

Pass criteria:

- UTC day key is used.
- Active windows are respected.
- Match mode, gameplay mode, ranked-only, clean-integrity, minimum duration, and leaver policy gates work.
- All criteria types increment correctly: matches, wins, eliminations, assists, flags, score, experience, hero play, hero-specific eliminations, ability eliminations, and flag-carrier eliminations.
- Mission completion requires all criteria.
- One match contribution can be applied only once.
- Repeated settlement after completion creates no duplicate grants.

Reward pass criteria:

- SOL mission reward creates a `daily_mission` player reward and uses mission idempotency key.
- Skin mission reward immediately creates or restores event skin ownership and marks grant `granted`.
- Game-token mission reward fails cleanly when token config is incomplete.
- Game-token mission reward fails cleanly when user has no linked wallet.
- With local token config and signer, game-token payout creates `gameTokenPayout`, submits local SPL transfer, and marks grant `granted`.
- Game-token payout retries failed rows until max attempts, then leaves actionable failure state.

Admin overview pass criteria:

- Active today, completed today, failed grants, and pending token payouts match database state.
- Audit list surfaces failed and pending grants.

## Wagers And Golden Biome Rewards

Even if launch disables paid wagers, test disabled behavior and settlement math because the code is present.

Pass criteria:

- Wager preflight returns disabled when wagers are off.
- Enabled wager rejects invalid cover charge and missing treasury/RPC.
- Payment intent requires authenticated user and linked/posted wallet.
- Native SOL verifier rejects missing signer, wrong memo, wrong sender, wrong recipient, underpayment, expired intent, and failed transaction.
- Start eligibility requires paid human players on both teams and ignores bots.
- Settlement math handles platform fee, winner share, and dust.
- Refund math never creates zero/negative net refunds; manual review is required when fee consumes refund.
- Wager stats increment wins/losses/draws and net won/lost amounts correctly.
- Golden biome eligibility returns disabled/not-configured/below-threshold reasons without sending transfers.
- Manual golden biome distribution requires admin and local signer in local-validator mode.

## API And Security Gates

Pass criteria:

- Cosmetics, rewards, missions, wagers, matchmaking, and admin mutation routes require the expected auth.
- Admin mutations require CSRF and allowed admin origin.
- Rate limits apply to cosmetics catalog, loadout, and purchase endpoints.
- Error payloads are user-actionable and do not expose secrets.
- Server never stores treasury private keys in DB.
- Settlement signer secret is read only from local environment.
- Logs include enough context for failed payment/reward diagnosis without logging signed transactions or secrets.

## Manual UI Launch Pass

Do this after automated and API checks are green. This is intentionally manual.

Skins:

- Anonymous catalog state.
- Authenticated catalog state.
- Login prompt for purchase/equip.
- Wallet link prompt.
- Wallet mismatch.
- Unsupported wallet transaction signing.
- Successful local-validator purchase.
- Pending submitted purchase reload.
- Sold-out state.
- Equip owned paid skin.
- Equip founder/event skin.
- Hidden/revoked skin fallback.

Rewards and missions:

- Daily mission tracker empty/loading/error.
- Mission progress after a match.
- Completed mission grant display for SOL, game token, and skin rewards.
- Failed game-token payout display.
- Admin mission create/update/duplicate/archive/reorder.
- Admin economy settings update.
- Admin skin shop enable/disable and per-skin price/supply update.
- Ranked locked state.
- Ranked token-required eligible and ineligible state.

Wagers, if launch-enabled:

- Wager preflight.
- Payment prompt.
- Paid/unpaid lobby status.
- Refund/settlement status.

## Launch Exit Criteria

Launch is blocked if any item is true:

- Any automated command in this plan fails.
- Paid skin purchase can credit ownership without a verified payment.
- A wrong memo, wrong mint, wrong recipient, wrong authority, underpayment, expired intent, or duplicate signature can credit a skin.
- Supply cap can be exceeded.
- Unowned or hidden skin can be equipped in a live match.
- Rewards duplicate on repeated match finalization.
- Rewards pay when anti-cheat, ranked hold, leaver, or minimum-duration gates should block them.
- Mission completion duplicates grants.
- Game-token payout can send to the wrong wallet or wrong mint.
- Ranked token gate can be enabled without a configured game token.
- Any flow uses `mainnet-beta` or a mainnet RPC during no-spend launch rehearsal.
- Admin mutation succeeds without valid admin auth and CSRF.

Launch can proceed when:

- All automated commands are green.
- Local app-stack API/database assertions are green.
- Local-validator skin purchase and reward payout rehearsals are green, or the corresponding features are disabled for launch.
- Manual UI launch pass is complete.
- All launch env vars are reviewed and point to the intended production settings only after no-spend rehearsal is complete.

## Evidence Checklist

Save this with the launch notes:

- Command outputs for automated checks.
- Environment variable snapshot with secrets redacted.
- Database counts for skin intents, ownerships, player rewards, mission grants, token payouts, and wager rows before and after test runs.
- Local validator mint, treasury, buyer, and settlement public keys used for rehearsal.
- List of disabled launch features, if any.
- Open bugs and explicit launch/no-launch decision.
