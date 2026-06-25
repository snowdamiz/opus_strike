# Admin Page User Stories and Endpoints

Last checked: 2026-06-24

Reader: an internal engineer or operator who needs to understand the current admin surface without rereading the implementation.

Post-read action: know what the admin pages can do and which server endpoints those pages call.

## Scope

- `/admin` renders the legacy admin dashboard.
- `/admin2` renders the newer sectioned admin console.
- Both pages use the same core API contract today. The newer console wraps those calls in a controller hook; the legacy dashboard keeps the same logic inside the page component.
- Both pages call the server through `config.serverHttpUrl`. In development this resolves from `ws://localhost:2567` to `http://localhost:2567`. In production it resolves from `VITE_SERVER_URL` or the default `wss://api.slopheroes.xyz` to HTTPS.
- The server mounts the admin API under `/admin`, so the full API paths are `/admin/api/...`.
- The admin API requires an `auth_token` cookie for a user whose wallet matches `ADMIN_WALLET`. Missing or non-admin access returns a not-found style response.
- Admin mutations also require an allowed origin and the `X-CSRF-Token` value returned by `GET /admin/api/overview`.
- `GET /admin/api/overview` is loaded initially, can be refreshed manually, and is polled every 3 seconds.

## User Stories

### Access

- As an authorized admin, I can open the admin page using my existing authenticated session.
- As an admin, I can see which admin user and wallet are active for the page.
- As an admin with an elevated anti-cheat wallet, I can see an anti-cheat role badge.
- As a non-admin or unauthenticated user, I cannot use the admin API.

### Overview

- As an admin, I can see the current sampled system status and when it was generated.
- As an admin, I can monitor high-level activity: connected clients, players, bots, game rooms, lobby rooms, lobby participants, running machines, and server processes.
- As an admin, I can monitor capacity: reserved players, maximum players, available slots, pressure, projected machine count, and whether capacity is full.
- As an admin, I can see attention items for capacity pressure, player reports, pending golden rewards, Redis health, and active broadcasts.
- As an admin, I can jump from attention items to the related section.

### Live Ops

- As an admin, I can set a global notification message shown to players.
- As an admin, I can view the current global notification and when it was updated.
- As an admin, I can remove the current global notification.
- As an admin, I can configure ranked entry as either locked or token-required.
- As an admin, I can configure the ranked gate token mint, token symbol, and whole-token amount required for entry.
- As an admin, I can see whether Solana RPC is configured for ranked gate checks.
- As an admin, I can configure the ranked cycle as season or pre-season.
- As an admin, I can set the ranked season number and end or start boundary.
- As an admin, I get a confirmation before a ranked season identity change that will archive the current season and reset player ratings.

### Players

- As an admin, I can view the player report queue with status, reporter, target, reason, details, match or room context, resolution, and timestamps.
- As an admin, I can mark a report as reviewing, cleared, or dismissed.
- As an admin, I can add a review or resolution note when changing report status.
- As an admin, I can apply a suspension or ban to a reported account with a reason.
- As an admin, I can search users by name, wallet, or user id.
- As an admin, I can page through the user rank list.
- As an admin, I can view a player's current rank, rating, ranked record, total record, peak rating, wallet, and login/update timing.
- As an admin, I can manually set a player's competitive rating from 0 to 5000.
- As an admin, I can record a reason for a manual rank adjustment.
- As an admin, I get a confirmation before saving a manual rank change.

### Economy

- As an admin, I can view and edit ranked reward settings.
- As an admin, I can enable or disable ranked token payouts.
- As an admin, I can set base ranked match payout, daily paid-match count, win bonus, assist bonus, flag capture bonus, and flag return bonus.
- As an admin, I can set reward guardrails: per-player match cap, whole-match cap, minimum match duration, payout batch size, and treasury reserve.
- As an admin, I can enable or disable the weekly ranked pool.
- As an admin, I can set the weekly prize pool and number of paid leaderboard placements.
- As an admin, I can set the platform wager fee in basis points.
- As an admin, I can enable or disable golden maps.
- As an admin, I can set golden map chance, winner SOL payout, SOL treasury reserve, and golden reward distribution mode.
- As an admin, I can view golden reward records, treasury eligibility, winner counts, transfer status, signatures, and errors.
- As an admin, I can manually distribute a pending or failed golden reward.
- As an admin, I can enable or lock the skin shop.
- As an admin, I can configure the skin shop token mint, symbol, and cluster.
- As an admin, I can see whether `SOLANA_RPC_URL` and `WAGER_TREASURY_WALLET` are ready for the skin shop.
- As an admin, I can enable or lock each paid skin for sale.
- As an admin, I can set each paid skin's base-unit token price.
- As an admin, I can set each paid skin's supply cap or leave it unlimited.
- As an admin, I can see sold count, reserved count, remaining supply, price version, and last audit update for skin shop items.
- As an admin, I get stale-edit protection when saving skin item settings through `expectedPriceVersion`.

### Infrastructure

- As an admin, I can see Redis health, distributed runtime mode, routing strategy, room creation strategy, Fly Replay status, and local process id.
- As an admin, I can see diagnostic warnings when room queries, machine registry, or matchmaker snapshots fail.
- As an admin, I can inspect machines by machine id, region, process count, players, bots, rooms, load, CPU utilization, event loop delay, memory, local CCU, capacity pressure, and last update.
- As an admin, I can inspect active game rooms by room id, machine, phase, mode, players, bots, clients, and capacity.
- As an admin, I can inspect active lobbies by lobby name, room id, machine, status, mode, humans, bots, and participants.
- As an admin, I can manually refresh the overview data.

### Anti-Cheat

- As an admin, account actions created from player reports are recorded through the anti-cheat evidence store.
- As an admin with elevated anti-cheat access, I can see the anti-cheat role badge.
- The overview payload includes anti-cheat review data, but the current admin pages do not render a dedicated anti-cheat review UI and do not call the standalone anti-cheat endpoints listed later in this document.

## Endpoints Accessed by the Current Admin Pages

Every request uses `credentials: include` and `cache: no-store`. Every POST includes `Content-Type: application/json` and `X-CSRF-Token`.

| Method | Path | Page trigger | Inputs sent by the page | What it does |
| --- | --- | --- | --- | --- |
| GET | `/admin/api/overview` | Initial load, 3 second poll, manual refresh, post-mutation refresh | none | Returns admin identity, CSRF token, status, totals, capacity, machines, rooms, diagnostics, anti-cheat review data, player reports, reward economy, golden rewards, global notification, ranked season, ranked entry gate, and skin shop overview. |
| GET | `/admin/api/users?limit=25&page=<page>&query=<query>` | First opening Players, search, clear search, pagination, post-rank-save reload | `limit`, `page`, `query`; server clamps limit to 1-100 and trims query to 128 chars | Returns paginated users, rank options, rating bounds, and current rank summaries. |
| POST | `/admin/api/users/:userId/rank` | Save player rank | `{ competitiveRating, reason }`; rating must be 0-5000 | Updates the user's competitive rating, updates peak rating if needed, and records a manual rank adjustment action. |
| POST | `/admin/api/player-reports/:reportId/status` | Review, clear, or dismiss report | `{ status, note }`; page uses `reviewing`, `cleared`, `dismissed`; server accepts report statuses `open`, `reviewing`, `cleared`, `actioned`, `dismissed` | Updates report status, resolution text, resolver, and resolution timestamp as applicable. |
| POST | `/admin/api/player-reports/:reportId/account-actions` | Suspend or ban from a report | `{ actionType, reason, expiresAt }`; page uses `suspension` or `ban`; server also accepts `lift_suspension` and `lift_ban` | Creates an anti-cheat account action for the report target and marks the report as actioned. |
| POST | `/admin/api/golden-biome/distribution-mode` | Change golden reward distribution mode in the golden rewards panel | `{ mode }` where mode is `manual` or `auto` | Updates only the golden reward distribution mode. |
| POST | `/admin/api/reward-economy` | Save reward economy | `{ playerRewards, wagers, goldenBiome }` | Updates ranked reward settings, wager fee settings, and golden biome settings in one save. The page converts golden SOL fields to lamports before sending. |
| POST | `/admin/api/golden-biome/rewards/:rewardId/distribute` | Distribute a pending or failed golden reward | `{}` | Sends or retries golden reward transfers for the selected reward. |
| POST | `/admin/api/global-notification` | Set global notification | `{ message }`; message is required and capped at 240 chars | Creates or replaces the active global notification. |
| POST | `/admin/api/global-notification/remove` | Remove global notification | `{}` | Clears the active global notification. |
| POST | `/admin/api/ranked-season` | Save ranked season | `{ mode, seasonNumber, endsAt }`; mode is `season` or `preseason` | Updates ranked season settings. If the season identity changes, the service archives the current season and resets current player ratings. |
| POST | `/admin/api/ranked-entry-gate` | Save ranked entry gate | `{ mode, tokenMintAddress, tokenSymbol, requiredTokenAmount }`; mode is `locked` or `token_required` | Updates ranked access settings. Token-required mode needs a mint, symbol, and positive whole-token amount. |
| POST | `/admin/api/skin-shop/settings` | Save skin shop settings | `{ enabled, tokenMintAddress, tokenSymbol, cluster }` | Updates global skin shop status and token configuration. The page prevents enabling without a token mint, treasury wallet, and RPC configuration. |
| POST | `/admin/api/skin-shop/items/:skinId` | Save one skin shop item | `{ saleEnabled, tokenAmountBaseUnits, maxSupply, expectedPriceVersion }` | Updates paid skin sale status, base-unit price, optional supply cap, price version, and audit metadata. |

## Reward Economy Payload Fields

`POST /admin/api/reward-economy` sends these nested groups:

| Group | Fields |
| --- | --- |
| `playerRewards` | `enabled`, `dailyRankedDripLamports`, `dailyRankedDripMaxMatches`, `minMatchDurationMs`, `objectiveWinLamports`, `objectiveFlagCaptureLamports`, `objectiveFlagReturnLamports`, `objectiveAssistLamports`, `maxPlayerMatchLamports`, `maxMatchPayoutLamports`, `treasuryReserveLamports`, `payoutBatchSize`, `weeklyEnabled`, `weeklyPoolLamports`, `weeklyTopPlayers` |
| `wagers` | `platformFeeBps` |
| `goldenBiome` | `distributionMode`, `enabled`, `chanceBps`, `winnerRewardLamports`, `treasuryMinLamports` |

## Admin Router Endpoints Not Currently Called by the Pages

The server also exposes these admin endpoints. They are available on the admin router, but the current `/admin` and `/admin2` pages do not call them directly.

| Method | Path | Inputs | What it does |
| --- | --- | --- | --- |
| GET | `/admin/api/anti-cheat/overview` | none | Returns anti-cheat review data from the evidence store. Similar data is already included in `/admin/api/overview`. |
| POST | `/admin/api/anti-cheat/cases/:caseId` | `{ status, note, resolution }`; status can be `open`, `investigating`, `resolved`, `false_positive`, or `escalated` | Updates an anti-cheat case and marks false positives when requested. |
| POST | `/admin/api/anti-cheat/ranked/:matchId/apply` | `{ reason }` | Applies a held ranked outcome. |
| POST | `/admin/api/anti-cheat/ranked/:matchId/cancel` | `{ reason }` | Cancels a held ranked outcome. |
| POST | `/admin/api/anti-cheat/account-actions` | `{ targetUserId, actionType, reason, evidenceCaseId, evidenceEventIds, expiresAt }`; action type can be `suspension`, `ban`, `lift_suspension`, or `lift_ban` | Creates an anti-cheat account action independent of a player report. |

## Current Limits and Gaps

- The admin pages do not directly stop machines, close rooms, kick players, or alter lobbies. Infrastructure is read-only.
- The admin pages do not currently render a dedicated anti-cheat case workflow, even though the server exposes anti-cheat endpoints.
- The admin pages rely on the existing auth cookie and the configured `ADMIN_WALLET`; there is no separate admin login flow in the pages.
- Both admin frontends access the same API endpoints today. The difference is presentation: `/admin` is the legacy monolith, while `/admin2` is the newer sectioned console.
