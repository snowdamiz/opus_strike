# Persistence Audit And Implementation Plan

Reader: the next engineer who will implement user-scoped persistence.

Post-read action: add durable gameplay persistence without changing the existing auth flow or requiring browser testing.

## Audit Summary

Changes are needed.

Auth persistence is mostly in place. User profiles, linked auth accounts, wallet addresses, Discord identities, login timestamps, and aggregate counters are modeled in Prisma. Sessions are signed into an HTTP-only cookie, pending registration is separated from completed user sessions, and lobby-to-game entry tickets carry a stable user identity into game rooms.

Lobby and game identity handling is also partly durable. Lobby and game rooms de-duplicate active sessions by authenticated user identity or guest identity. The local client ID is treated as reconnect convenience rather than authority, which is the right security shape.

Gameplay persistence is incomplete. Match scores, kills, deaths, assists, flag captures, and flag returns are tracked on in-memory room/player state only. They are reset after game end and are lost if the process restarts. If a player leaves before game end, their in-memory player row is deleted, so their match stats are also lost before any future persistence hook could read them.

The existing user aggregate stats are too narrow for the live scoreboard. Users currently expose totals for games, wins, kills, deaths, and captures, but live gameplay also tracks assists and flag returns. There is no durable per-match record, no final red/blue score history, no per-user match outcome, and no idempotency boundary around persisting a completed game.

Client persistence is limited to local settings/session convenience plus the server-backed auth user payload. It should not be the source of truth for scores or stats.

## Persistence Goals

Persist completed game results per authenticated user.

Keep room gameplay responsive even if persistence fails; database writes should be non-blocking from the player experience and logged with enough context to retry or diagnose.

Exclude guests, bots, development NPCs, and development-only kill helpers from durable competitive stats unless a future product decision says otherwise.

Preserve stats for authenticated users who disconnect before game end.

Make persistence idempotent so duplicate `game_end` transitions, room disposal, or retry logic cannot double-count a user.

## Data Model Plan

Extend the user aggregate counters:

- `totalAssists`
- `totalFlagReturns`
- `totalScore`
- optionally `totalLosses` and `totalDraws` if profiles need complete outcome splits

Add a durable match table:

- stable match ID
- room ID and optional lobby ID
- map seed
- start and end timestamps
- final red and blue scores
- winning team, nullable for draws
- created/updated timestamps

Add a durable match participant table:

- match ID
- user ID
- player session ID seen in the room
- display name used in the match
- team and hero
- per-match kills, deaths, assists, flag captures, flag returns
- computed player score
- win/loss/draw outcome
- join and optional leave timestamps

Use a uniqueness constraint on match ID plus user ID. If the same authenticated user reconnects under a new session, merge into the same participant record instead of creating a second durable row.

## Server Runtime Plan

Create a small match persistence ledger owned by the game room.

When the first playable round starts for a fresh game:

- create an in-memory match persistence ID
- capture room ID, lobby ID, map seed, and start time
- register each authenticated human player as a participant
- ignore guests and bots for durable stats

When an authenticated human joins mid-game:

- register or merge their participant entry
- keep their team, display name, and hero up to date

When gameplay events occur:

- on player death, increment victim deaths in the ledger
- on player kill, increment killer kills in the ledger
- on assists, increment assister assists in the ledger
- on flag capture, increment captures and score contribution
- on flag return, increment returns and score contribution
- avoid counting NPC/dev-only kills in durable stats

When a player leaves:

- mark the participant `leftAt`
- keep their accumulated stats in the ledger
- do not delete their ledger entry

When the game ends:

- calculate winner/draw from final red and blue scores
- calculate each participant outcome
- compute player score from server-owned events
- persist the match and participants in one transaction
- increment user aggregate counters in the same transaction
- mark the in-memory match as persisted before scheduling room reset

If persistence fails:

- log room ID, match ID, lobby ID, map seed, final score, and error
- do not crash the room
- keep the room reset behavior unchanged

## API And Client Plan

Update serialized user stats returned by auth/session APIs to include any new aggregate counters.

Update client user stats types to match the server response.

If the product needs profile/history UI, add a user-scoped match history endpoint after persistence lands. That endpoint should return only the authenticated user’s participant rows plus match summary data.

Do not trust client-submitted stats. The server room remains the source of truth.

## Verification Plan

No browser testing.

Use focused server-side verification:

- typecheck the server and shared packages
- run existing server scripts/tests if available
- add a unit-level test or harness for the persistence mapper/service
- verify the Prisma migration applies against the configured development database

Manual browser validation can remain with the user after implementation.

## Implementation Order

1. Add the Prisma schema changes and migration.
2. Add a small server persistence helper for match/participant writes.
3. Add the game-room ledger and update it from existing kill/objective/leave/end-game events.
4. Extend auth user serialization and client user stats types.
5. Add focused non-browser verification.
6. Re-audit for double-counting, guest/bot exclusion, and disconnect handling.

## Notes

The current auth flow does not need a redesign for this work. The missing piece is carrying the already-resolved user identity into a durable gameplay results ledger and committing that ledger once per completed game.
