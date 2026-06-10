# Solana Custom Lobby Crypto Plan

Reader: the internal engineer implementing crypto-staked custom lobbies for Opus Strike.

Post-read action: add SOL-backed custom lobby cover charges where players may join before paying, but a wagered lobby cannot start until every required human player has paid. At game end, the winning paid human team receives 95% of the pot and the developer treasury receives 5%.

This plan intentionally treats legal and compliance work as out of scope. It focuses only on product behavior, Solana payments, custody, server authority, settlement, and verification.

## Current State

- Custom lobbies are Colyseus `lobby_room` instances created from the client through the existing network context.
- Public lobby listing is exposed over HTTP and server-sent events from lobby room metadata.
- Lobby hosts can start a game with `startGame`; the server validates host status, team assignment, readiness, and then begins map vote.
- Map vote finalization creates a `game_room` from the lobby and issues signed per-player entry tickets.
- Direct game-room joins are disabled; game-room entry is already bound to a signed lobby ticket.
- Game rooms own the authoritative score, winner, `gameEnd` event, and match persistence ledger.
- The app already has Phantom wallet auth/sign-message support, but it does not yet expose transaction signing or payment status.

The important shape is already good: the server owns lobby start, game entry, and match outcome. Crypto support should attach to those server-owned decisions instead of trusting client UI state.

## Target Product Behavior

- Lobby creators can enable a crypto pot from the Create Game flow.
- The creator sets one cover charge per human player at lobby creation.
- The MVP uses native SOL on Solana mainnet.
- A zero-charge or non-wagered lobby keeps the current behavior.
- Players can enter a wagered lobby without paying.
- Paying a wagered entry requires a connected Solana wallet that can sign transactions.
- Unpaid players can choose teams, chat, and otherwise sit in the lobby.
- The host cannot move the lobby into map vote or game start until every required human player has paid.
- Bots do not pay and never receive payouts.
- The cover charge cannot change after lobby creation. If we later allow edits, edits must be blocked after the first payment is credited.
- Wagered MVP lobbies require at least one paid human on each team before start. This avoids single-player/self-pot edge cases.
- When the match has a winning team, 95% of the total credited pot is split equally between paid human players on the winning team.
- The remaining 5%, plus any lamport dust from integer division, goes to the developer treasury.
- When the match is a draw, cancelled before game start, or ended without an authoritative winner, paid entries are refunded.
- A player who leaves after the game starts remains financially committed. Their payout eligibility is based on their paid entry and assigned team at game start.

## Custody Model

Use an operator-controlled Solana wallet for the first implementation.

- `WAGER_TREASURY_WALLET` is the public deposit and treasury address shown to players.
- A backend settlement signer controls payouts from that wallet.
- Store the settlement signer through deployment secrets for the MVP; move it to KMS/HSM or a multisig-controlled signer before meaningful balances accumulate.
- Keep an explicit hot-wallet balance alert because settlement needs enough SOL for transaction fees.
- Never request or store player private keys or seed phrases.

This is intentionally custodial because the product requirement says funds should go into a Solana wallet controlled by us. A later Anchor escrow program can reduce custody risk, but it is not required for the first shippable version.

## Payment Flow

1. Host creates a wagered lobby.
   - Client sends `wager.enabled`, `coverChargeLamports`, `token = SOL`, and optional display metadata in the existing lobby creation options.
   - Server validates min/max cover charge and stores immutable wager config.
   - Lobby metadata includes wager state so lobby browsers can show the charge.

2. Player joins the lobby.
   - Server sends lobby state with wager config and each human player's payment status.
   - Player can remain unpaid.
   - Player sees a Pay Entry action if they are unpaid and the lobby is still waiting.

3. Player requests a payment intent.
   - Server creates a unique intent for `(lobbyId, userId, walletAddress)`.
   - Server rejects the request if the player does not have a connected Solana wallet address.
   - Intent includes amount, token, treasury address, memo/reference, expiry, and current payment status.
   - Reusing the action returns the active unpaid intent rather than creating duplicates.

4. Client submits payment.
   - Use the connected Phantom wallet to build and sign a native SOL transfer to `WAGER_TREASURY_WALLET`.
   - Include a Memo Program instruction like `opus-wager:<intentId>`.
   - Show recipient, amount, token, and lobby name before wallet signature.
   - Send the resulting transaction signature to the server.

5. Server verifies payment.
   - Do not trust the client-reported signature by itself.
   - Fetch the confirmed transaction from the configured RPC.
   - Verify transfer recipient, sender wallet, lamports, memo/reference, slot time, and that the signature has not already credited another intent.
   - Mark the payment credited only after confirmation.
   - Broadcast `paymentStatusChanged` to the lobby.

6. Server gates game start.
   - `startGame` checks all current non-bot players who are assigned to red or blue.
   - If any required human is unpaid, send an error with the unpaid player list.
   - Re-run the same paid-player check before map vote finalization creates the game room.

The second gate matters because players can join, leave, reconnect, or change teams between the host click and final game-room creation.

## Payout Rules

Use integer lamports only.

- `totalPotLamports = sum(credited paid entries locked at game start)`
- `developerFeeLamports = floor(totalPotLamports * 500 / 10000)`
- `winnerPoolLamports = totalPotLamports - developerFeeLamports`
- `winnerShareLamports = floor(winnerPoolLamports / winningPaidHumanCount)`
- `dustLamports = winnerPoolLamports - winnerShareLamports * winningPaidHumanCount`
- Developer receives `developerFeeLamports + dustLamports`.

Winning paid humans are determined from the locked game-start payment ledger, not from client state at game end.

Refund cases:

- Lobby cancelled before game-room creation: refund all credited entries.
- Host kicks a paid player before game-room creation: refund that player and mark them removed from the paid roster.
- Paid player voluntarily leaves before game-room creation: default to refund and remove them from the paid roster.
- Draw: refund all credited entries.
- Server-forced no-result game end: refund all credited entries.

Forfeiture case:

- Player leaves after game-room creation: no automatic refund. Their team result determines payout.

## Data Model Plan

Add persistent payment records next to the existing user and match persistence tables.

`WageredLobby`

- `id`
- `lobbyId`
- `gameRoomId`
- `matchId`
- `status`: `waiting`, `locked`, `in_game`, `settling`, `settled`, `refunding`, `refunded`, `failed`
- `token`: initially `SOL`
- `coverChargeLamports`
- `treasuryWallet`
- `platformFeeBps`: default `500`
- `createdByUserId`
- `createdAt`, `updatedAt`, `lockedAt`, `settledAt`

`WagerPayment`

- `id`
- `wageredLobbyId`
- `lobbyPlayerId`
- `userId`
- `walletAddress`
- `teamAtLock`
- `amountLamports`
- `memo`
- `intentExpiresAt`
- `status`: `intent_created`, `submitted`, `confirmed`, `credited`, `refunding`, `refunded`, `settled`, `failed`
- `depositSignature`
- `refundSignature`
- `creditedAt`, `refundedAt`, `settledAt`

`WagerSettlement`

- `id`
- `wageredLobbyId`
- `matchId`
- `winningTeam`
- `totalPotLamports`
- `developerFeeLamports`
- `winnerPoolLamports`
- `status`: `pending`, `processing`, `complete`, `failed`
- `attemptCount`
- `lastError`
- `createdAt`, `updatedAt`, `completedAt`

`WagerSettlementTransfer`

- `id`
- `settlementId`
- `kind`: `winner_payout`, `developer_fee`, `refund`
- `recipientWallet`
- `amountLamports`
- `signature`
- `status`: `pending`, `submitted`, `confirmed`, `failed`

Important constraints:

- Unique credited payment per `(wageredLobbyId, userId)`.
- Unique deposit signature.
- Unique memo/reference.
- Unique settlement per wagered lobby.
- Unique settlement transfer idempotency key per recipient/kind/settlement.

## Server Implementation Plan

Add a wager service owned by the server process.

Responsibilities:

- Validate wager config during lobby creation.
- Create and expire payment intents.
- Verify Solana transactions by querying RPC.
- Broadcast payment status into active lobby rooms.
- Lock paid entries when a game starts.
- Refuse map vote/game creation while required humans are unpaid.
- Trigger settlement from authoritative `gameEnd`.
- Retry failed confirmations, refunds, and settlement transfers idempotently.

Lobby room changes:

- Extend join/create options with wager config.
- Extend lobby state and metadata with wager display fields.
- Include payment status in `lobbyState`, `playerJoined`, and a new `paymentStatusChanged` message.
- Add messages or HTTP-backed calls for `createPaymentIntent` and `submitPaymentSignature`.
- In `handleStartGame`, block if wagered and required humans are unpaid.
- In `finalizeMapVote`, re-check payment lock before `createGameFromLobby`.
- In `createGameFromLobby`, pass locked wager context to the game room and include wager id in game entry tickets or room options.

Game room changes:

- Store wager context from room options or load it by `lobbyId`.
- On `endGame`, use the authoritative `winningTeam` and final score to request settlement.
- Tie settlement to the existing match persistence ledger's `matchId`.
- Include payout status in logs and optionally in `gameEnd` payload once available.

HTTP/API additions:

- `POST /wagers/lobbies/:lobbyId/intents`
- `POST /wagers/intents/:intentId/signature`
- `GET /wagers/lobbies/:lobbyId`
- `POST /wagers/settlements/:settlementId/retry` for admin/manual recovery

Background jobs:

- Confirm submitted deposits that are still pending.
- Expire unpaid intents.
- Retry failed settlements with bounded backoff.
- Reconcile credited payments against treasury transactions by memo.

## Client Implementation Plan

Create Game flow:

- Add a crypto pot toggle.
- Add SOL cover charge input when enabled.
- Validate client-side min/max, but keep server validation authoritative.
- Show that the charge is per human player.

Lobby browser:

- Show wagered lobbies with token and cover charge.
- Preserve current join behavior; joining does not require payment.

Lobby screen:

- Show each human player's payment status.
- Show pot total from credited payments.
- Show Pay Entry for the local unpaid player.
- Use Phantom transaction signing for payment.
- Show submitted/confirming/paid/error states.
- Keep Ready separate from Paid.
- Disable or explain the host Start button while any required player is unpaid.

Map vote/game transition:

- If the server rejects start due to unpaid players, show the player names/status.
- Once the game starts, payment roster is locked and cannot be changed from the client.

Match summary:

- Show payout pending/complete/failed when settlement status is available.
- Winners see their expected share and final transaction signature after confirmation.
- Draw/refund cases show refund status.

## Solana Implementation Details

MVP native SOL transfer:

- Build a transaction with a System Program transfer to `WAGER_TREASURY_WALLET`.
- Add a Memo Program instruction carrying `opus-wager:<intentId>`.
- Use the connected wallet as fee payer and sender.
- Confirm with `confirmed` first for UX, then mark final after the server observes sufficient confirmation.

Server verification:

- Configure `SOLANA_CLUSTER=mainnet-beta`.
- Configure `SOLANA_RPC_URL`.
- Fetch parsed transaction by signature.
- Verify exact or greater-than-required lamports moved from player wallet to treasury wallet.
- Verify memo equals the payment intent memo.
- Verify transaction slot/block time is after intent creation and before expiry grace.
- Reject reused signatures and reused memos.
- Mark underpayment as failed.
- For overpayment, credit only the required cover charge and flag the surplus for manual refund or automatic surplus refund.

Settlement transactions:

- Batch transfers where safe, but keep idempotency per recipient.
- Store every transaction signature before waiting for confirmation.
- Mark a transfer confirmed only after RPC confirms it.
- If a transaction is submitted but status is unknown, retry by checking signature before sending a replacement.

Future SPL token support:

- Add token mint, token decimals, source associated token account, and treasury associated token account fields.
- Verify SPL token transfer instructions instead of lamport deltas.
- Keep payout math in base units.

## Security And Failure Modes

- Server is the only authority for paid status, start eligibility, locked teams, and settlement.
- Never trust client-side wallet callbacks without RPC verification.
- Never let the host change cover charge after payment begins.
- Never issue game entry tickets for a paid game until the wager ledger is locked.
- Prevent direct game-room joins from bypassing paid lobby state.
- Use idempotent settlement records so duplicate `gameEnd`, retries, or process restarts cannot double-pay.
- Keep transaction signatures, intent ids, and match ids in logs.
- Do not log private keys, raw secret material, or full auth cookies.
- Add alerts for settlement failure, low treasury balance for fees, and deposits without matching intents.

## Verification Plan

No browser testing.

Automated checks:

- Unit-test payout math, including uneven teams and lamport dust.
- Unit-test paid-start gate with unpaid, paid, bot, reconnect, kick, and voluntary leave cases.
- Unit-test transaction parser against fixture transactions for valid payment, underpayment, wrong memo, wrong recipient, wrong sender, duplicate signature, and expired intent.
- Unit-test settlement idempotency so duplicate game-end calls do not double-pay.
- Add a server harness for refund/draw/cancel flows.
- Typecheck client, server, and shared packages.
- Run existing server-side match persistence and authority tests.

Manual checks for the user:

- Create a wagered lobby and confirm unpaid users can join.
- Confirm Start is blocked until all required humans are paid.
- Confirm payment status updates after an on-chain transfer.
- Complete a match and verify winners/developer receive expected lamports.
- Force a draw/cancel and verify refunds.

## Implementation Slices

1. Schema and config
   - Add wager tables, Prisma migration, Solana RPC config, treasury wallet config, min/max cover charge, and platform fee bps.

2. Wagered lobby creation
   - Add create-lobby wager options, server validation, immutable lobby metadata, lobby browser display, and lobby state serialization.

3. Payment intents and verification
   - Add intent creation, Phantom transaction signing, signature submission, server RPC verification, and realtime payment status broadcasts.

4. Start gate and roster lock
   - Block `startGame` and map vote finalization until all required humans are paid, then lock paid players and teams.

5. Game-room wager handoff
   - Carry wager id and locked paid roster into the game room through room options and/or signed entry tickets.

6. Settlement service
   - Trigger settlement from authoritative game end, calculate payouts, send winner/developer transfers, and persist signatures/status.

7. Refund paths
   - Handle pre-game cancel, kick, voluntary pre-game leave, draw, and no-result refunds.

8. Reconciliation and admin recovery
   - Add background retries, unmatched deposit detection, settlement retry endpoint, and operational logs.

## Open Product Decisions

- Minimum and maximum SOL cover charge.
- Whether overpayment should be automatically refunded or manually reviewed.
- Whether paid players can switch teams after paying; safest MVP answer is yes before lock, no after lock.
- Whether wagered lobbies can include bots; safest MVP answer is yes, but require one paid human per team and never pay bots.
- How much settlement status to expose publicly in match summary versus keeping it in account/history UI.
