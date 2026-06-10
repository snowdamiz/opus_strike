# Ranked Mode Wager Implementation Plan

Reader: the next engineer implementing ranked matchmaking, SOL entry payments, refunds, and the Quick Play rank split.

Post-read action: ship a ranked mode where ranked matches are paid wager matches, while Quick Play keeps awarding normal account progression without changing competitive rank.

## Outcome

Quick Play should no longer mutate any ranked fields. A Quick Play match can still award normal aggregate stats, score, experience, and level progress, but it must not change:

- `competitiveRating`
- `rankedGames`
- `rankedWins`
- `rankedLosses`
- `rankedDraws`
- `rankedPlacementsRemaining`
- `rankedPeakRating`
- `rankedLastMatchAt`
- match participant rating snapshots

Ranked mode becomes the only mode that changes competitive rank. Every ranked match is a wager match. A player must pay $5 worth of native SOL before they are counted as queued for ranked matchmaking.

If a paid player leaves ranked queue before the game starts, is kicked before the game starts, loses their queue slot because the server disposes the room, or the server fails to start the game, refund the payment. Refunds do not make the player whole for network fees. The player naturally pays the original deposit transaction fee from their wallet, and the refund transfer should send back the credited amount minus the outbound refund transaction fee. Do not charge platform fees on refunds.

## Current State

The ranking implementation currently treats Quick Play as the ranked path. Matchmaking tickets carry competitive rating and rank division data. Lobby and game rooms can mark a Quick Play match as ranked eligible, and completed match persistence updates ranked fields when `rankedEligible` is true.

The wager implementation already supports SOL payment intents, payment verification, lobby-level wager state, roster locking, settlement, pre-game refund attempts, background retry jobs, and payment status broadcasts.

The ranked implementation should reuse the wager service instead of creating a second money movement system.

## Core Decisions

Use an explicit match mode everywhere the server makes progression, rank, wager, and queue decisions. Recommended modes:

| Mode | Rank changes | Experience/level | Wager required | Bots |
| --- | --- | --- | --- | --- |
| `quick_play` | No | Yes | No | No at launch |
| `ranked` | Yes | Yes | Yes | No |
| `custom` | No | Yes | No | Allowed by lobby settings |
| `custom_wager` | No | Yes | Optional creator choice | Allowed by lobby settings |

Keep the existing visible rank model and rating update algorithm for ranked mode. Do not invent a second public rank.

Quick Play may continue using competitive rating as a matchmaking hint if that keeps the current experience stable, but Quick Play results must not update competitive rating. If that eventually makes Quick Play matching stale for players who never play ranked, add a separate hidden unranked MMR later. That is not required for this ranked-mode launch.

Ranked queue requires an authenticated user with a linked Solana wallet. Guests cannot enter ranked queue.

Disable ranked host powers. Ranked queue should not expose host kick, bot management, custom team selection, or manual start controls. If a server-side removal still happens before game start, refund the paid player.

## Quick Play Rank Split

Replace the current "Quick Play means ranked eligible" condition with a mode-aware eligibility check.

Quick Play persistence should still:

- create the completed match record
- create participant records
- increment total games, wins, losses, draws, kills, deaths, assists, captures, returns, score, and experience
- drive account level from total experience

Quick Play persistence should not:

- call the ranked rating update calculator
- write rating before/after/delta snapshots
- increment ranked aggregate fields
- apply ranked leaver penalties
- display match-end rank deltas

Rename code paths like "ranked quick play candidate" to mode-neutral names so future readers do not have to remember that Quick Play is no longer ranked.

## Ranked Entry Price

Add a server-owned ranked entry quote.

Configuration:

- `RANKED_SOL_ENTRY_ENABLED`
- `RANKED_ENTRY_USD_CENTS`, default `500`
- `RANKED_ENTRY_QUOTE_TTL_MS`, default 5 minutes
- `RANKED_ENTRY_PRICE_SOURCE`
- `RANKED_ENTRY_PRICE_STALE_MS`

The server resolves $5 USD to native SOL lamports and returns:

- quote id
- USD cents
- SOL/USD price used
- cover charge lamports
- price source
- quote expiration
- Solana cluster

All players in a ranked match should pay the same lamport amount. To preserve equal stakes, ranked matchmaking rooms should be grouped by quote id or by exact cover charge lamports. Existing paid players keep their quoted amount through match start. New players should only join rooms with the same active quote amount, or a new room should be created.

Quote creation and payment amount calculation must be server-side. The client only displays the quote and signs the payment transaction.

## Ranked Queue Flow

Use the existing lobby room as the queue container, but split the player state into two phases:

- `payment_required`: player is in a provisional ranked queue room but is not counted as queued
- `queued`: player's wager payment is credited and the player counts toward ranked matchmaking

Recommended flow:

1. Client requests a ranked entry quote.
2. Client requests a ranked matchmaking ticket that includes user id, rank, target division, mode `ranked`, quote id, and cover charge lamports.
3. Client joins or creates a lobby room with mode `ranked`, the ranked ticket, and wager options using the quoted cover charge.
4. The lobby creates a wagered lobby immediately.
5. The player creates a payment intent, signs the SOL transfer, and submits the signature or signed transaction.
6. The wager service verifies the transfer and marks the payment `credited`.
7. Only after `credited` does the ranked room count that user in queue status and start-match readiness.
8. When the required full human count is reached, lock the paid roster, start map vote or start game, and pass the wager context into the game room.

Queue status should report paid queued players separately from unpaid provisional players. The ranked screen can show "confirming payment" before it shows the user as queued.

## Ranked Match Eligibility

A match is ranked eligible only when all of these are true:

- mode is `ranked`
- all participants are authenticated human users
- no bots are present
- the match reached the required full human count
- every participant has a credited, locked wager payment for the ranked lobby
- the game room was created from the ranked queue
- the server has a valid wager context for settlement
- the match reaches a valid game-end or no-contest state

The current final eligibility check excludes wager contexts. Ranked mode must invert that for ranked matches: ranked eligibility should require the ranked wager context. Custom wager lobbies remain unranked.

If the game starts and completes with a winner, update rank and settle the wager pot. If the game starts but is marked no-contest because of server failure or invalid match conditions, skip rank updates and refund all locked payments using the refund policy.

## Wager Settlement

Completed ranked matches should use the existing settlement flow:

- winning team receives the winner payout
- configured platform fee applies only to completed winner settlements
- ranked wager stats update from settled payments
- ranked rating updates are persisted in the same transaction as completed match persistence where practical

Refund settlements should not take a platform fee.

If gameplay supports true draws, treat draw settlement as a refund-style settlement unless product decides to split the pot another way. The important invariant is that no ranked rating delta should be applied for an operational no-contest.

## Refund Policy

Refund triggers before game start:

- user presses cancel after payment is credited
- user disconnects or leaves queue after payment is credited
- server kicks or removes a paid player before game start
- duplicate session cleanup removes a paid session before game start
- ranked lobby is disposed before game start
- map vote or game room creation fails after roster lock
- quote or ticket expires after payment but before queue admission
- queue admission fails because the room becomes full or invalid

Refund triggers after game start:

- server aborts the match before a valid result
- game room fails before match persistence can produce a valid result
- no-contest administrative resolution

Refund amount:

1. Start with the credited payment amount.
2. Do not add the user's original deposit transaction fee. The wallet already paid it.
3. Estimate or compute the outbound refund transaction fee for the treasury transfer.
4. Send `creditedAmountLamports - outboundRefundFeeLamports`.
5. Store the gross credited amount, outbound fee, net refund amount, refund reason, refund signature, and timestamps for audit.

Use the exact fee from the built transaction message when the RPC can provide it. If exact fee lookup fails, use a conservative configured fallback and record that fallback was used. Never send a negative refund; if the fee would exceed the credited amount, mark the refund for manual review.

Refunds must be idempotent. Retrying an existing submitted refund should first check the existing signature status. If a previous signature is unknown, require manual review before replacement.

## Data Model Plan

Add a persisted match mode to completed matches and any room metadata that needs to survive process restarts.

Add ranked quote records or an auditable equivalent with:

- quote id
- USD cents
- SOL/USD price
- cover charge lamports
- price source
- created at
- expires at

Extend wager payment or settlement transfer audit data with:

- refund reason
- refund gross lamports
- refund outbound fee lamports
- refund net lamports
- refund fee source, exact or fallback

Keep user ranked fields as the source of public rank. Do not add separate "ranked wallet" fields unless the auth model starts allowing multiple Solana wallets per user.

## Server API Plan

Quick Play:

- keep a Quick Play ticket endpoint
- include mode `quick_play` in the signed ticket
- keep rank payloads for display and optional matchmaking hints
- do not mark Quick Play rooms as ranked eligible

Ranked:

- add a ranked quote endpoint
- add a ranked ticket endpoint
- include mode `ranked`, quote id, cover charge lamports, user id, rank data, target division, issued time, expiration, and nonce in the signed ticket
- reject guests
- reject users without a linked Solana wallet
- reject stale quotes
- reject disabled wager configuration

Lobby and game room options should carry the signed mode. Do not trust client-supplied mode strings without a valid ticket.

## Client Plan

Add a Ranked entry point beside Quick Play.

Ranked entry behavior:

- requires signed-in user
- requires linked Solana wallet
- shows current rank
- shows the quoted $5 SOL amount and quote expiration
- opens the ranked matchmaking screen
- guides the user through payment signing and confirmation before showing queued status

Ranked matchmaking screen states:

- loading quote
- wallet required
- payment required
- awaiting signature
- confirming payment
- queued
- starting match
- canceling and refunding
- refunded
- payment failed

Cancel behavior:

- if no credited payment exists, leave the room with no refund work
- if payment is credited and the game has not started, leave and show refunding/refunded status from server events
- if payment is submitted but not credited, show a pending status and let the background verifier either credit then refund, expire, or fail it

Quick Play UI should remove wording that implies rank movement. It can still show the user's rank badge as profile identity, but match-end UI should only show experience/level progress for Quick Play.

## Observability And Admin Tools

Log ranked money movement with structured fields:

- mode
- lobby id
- game room id
- match id
- user id
- payment id
- quote id
- deposit signature
- refund signature
- settlement id
- refund reason
- gross lamports
- net lamports
- fee lamports

Add admin/retry surfaces for:

- stuck submitted deposits
- stuck refunding payments
- failed settlements
- no-contest resolution
- manual refund review when prior signatures are unknown

Background jobs should continue retrying submitted deposits, refunding payments, and failed settlements. Ranked should not rely on a client staying connected for refunds to complete.

## Implementation Slices

1. Mode split and Quick Play rank disable
   - Add signed match mode to matchmaking tickets.
   - Add match mode to lobby/game room options and completed match persistence.
   - Force Quick Play `rankedEligible` to false.
   - Verify Quick Play still increments experience and total stats.

2. Ranked quote and ticket
   - Add server-side $5-to-lamports quote generation.
   - Persist or audit quote data.
   - Add ranked ticket validation with quote id and cover charge lamports.
   - Reject guests and users without linked wallets.

3. Ranked queue payment gate
   - Allow ranked queue rooms to create wagered lobby state.
   - Mark unpaid ranked players as provisional, not queued.
   - Count only credited players for queue status and start readiness.
   - Group ranked rooms by quote id or exact cover charge lamports.

4. Ranked eligibility and game startup
   - Require full paid human roster.
   - Lock the wager roster before game creation.
   - Pass ranked mode and wager context into the game room.
   - Allow ranked eligibility when the wager context belongs to ranked mode.
   - Keep custom wager lobbies unranked.

5. Refund fee accounting
   - Add refund gross, outbound fee, net amount, and reason fields.
   - Change refund transfers to send credited amount minus outbound refund fee.
   - Apply the same refund fee policy to queue cancels, server removals, room disposal, start failures, and no-contest refunds.
   - Keep refund retries idempotent.

6. Ranked settlement and rank updates
   - Persist ranked match outcomes only for valid completed ranked matches.
   - Settle winner payouts through the wager service.
   - Skip rank deltas for refunds and no-contests.
   - Refresh user stats and rank payloads after match completion.

7. Client ranked UX
   - Add Ranked button and ranked matchmaking flow.
   - Add payment states to the matchmaking screen.
   - Show refunding/refunded states on cancellation or server removal.
   - Remove Quick Play rank-delta presentation.

8. Verification and rollout
   - Add server tests for Quick Play rank immutability.
   - Add server tests for ranked wager eligibility.
   - Add wager service tests for net-of-fee refunds.
   - Add queue tests proving unpaid players do not count.
   - Add persistence tests proving custom wagers remain unranked.
   - Run automated unit/integration tests only; browser testing is left to the user.
   - Gate ranked mode behind config until refund and settlement retry paths pass.

## Test Scenarios

Quick Play:

- completing a Quick Play match increments experience and total games
- completing a Quick Play match leaves all ranked fields unchanged
- Quick Play match participants have no rating delta snapshots

Ranked queue:

- guest cannot request ranked ticket
- user without linked wallet cannot request ranked ticket
- unpaid ranked player is not counted in queue status
- credited ranked player is counted in queue status
- ranked rooms do not mix quote amounts

Refunds:

- paid user cancel before game start creates a refund for net amount
- paid user kicked before game start creates a refund for net amount
- ranked lobby dispose refunds all credited payments for net amount
- game creation failure after lock refunds all locked payments for net amount
- retrying a refund with confirmed existing signature does not send another transfer

Ranked matches:

- full paid ranked match with winner updates competitive rating
- full paid ranked match with winner settles wager payout
- custom wager match settles wager but does not update competitive rating
- ranked no-contest refunds and does not update competitive rating

## Rollout

Ship behind `RANKED_SOL_ENTRY_ENABLED=false` by default.

Deploy the Quick Play rank split first so future Quick Play matches stop changing rank before ranked mode opens.

Enable ranked mode on a non-production Solana cluster with small configured quote values for operational testing.

Enable production ranked queue only after:

- treasury wallet and settlement signer are configured
- quote provider health checks are green
- refund retry jobs are running
- settlement retry jobs are running
- admin retry path is documented
- test coverage proves Quick Play cannot update rank

