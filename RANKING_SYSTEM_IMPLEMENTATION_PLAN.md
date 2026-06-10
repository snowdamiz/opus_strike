# Ranking System Implementation Plan

Reader: the next engineer implementing competitive ranks, matchmaking, and rank display.

Post-read action: replace the current simplified matchmaking buckets with a durable ranked system that displays player ranks to other users and uses the same competitive rating model for Quick Play matchmaking.

## Product Shape

The visible rank ladder is:

- Plastic
- Bronze
- Silver
- Gold
- Diamond
- Unemployed

Each tier has four numbered divisions:

- Division 1 is the entry division for that tier.
- Division 4 is the promotion-edge division for that tier.
- Example progression: Gold 1, Gold 2, Gold 3, Gold 4, Diamond 1.

Players can have a temporary `Unranked` state during placement, but `Unranked` is not a ladder tier. It exists only to avoid pretending a fresh account has a proven public rank.

## Core Decisions

Use one hidden numeric `competitiveRating` for both matchmaking and rank display.

Derive the visible rank from `competitiveRating`. Do not store rank labels as authoritative state except as optional match-end snapshots for audit/history.

Only authenticated human players should gain or lose competitive rating. Guests may queue with a provisional default rating, but they should see a sign-in prompt instead of earning persistent rank.

Only full-human Quick Play matches should count as ranked at launch. Custom lobbies, private lobbies, bot-filled matches, wagered lobbies, and development-only flows remain unranked unless a future product decision expands ranked eligibility.

Keep existing aggregate score, level, and wager stats. Ranked rating is a separate competitive progression, not a replacement for account level or total score.

## Rank Model

Create shared rank definitions with stable IDs, labels, rating thresholds, division count, colors, and icon keys.

Recommended initial thresholds:

| Tier | Division 1 | Division 2 | Division 3 | Division 4 |
| --- | ---: | ---: | ---: | ---: |
| Plastic | 600 | 650 | 700 | 750 |
| Bronze | 800 | 850 | 900 | 950 |
| Silver | 1000 | 1050 | 1100 | 1150 |
| Gold | 1200 | 1250 | 1300 | 1350 |
| Diamond | 1400 | 1450 | 1500 | 1550 |
| Unemployed | 1600 | 1650 | 1700 | 1750 |

Rating below 600 still displays Plastic 1. Rating at or above 1750 displays Unemployed 4 and continues accumulating progress internally.

Shared helper behavior:

- `getRankFromRating(rating, rankedGames)` returns `Unranked` until placement is complete.
- `getRankDivisionIndex(rating)` returns a zero-based ladder index for matchmaking distance.
- `getRankProgress(rating)` returns current division floor, next division floor, and progress percentage.
- `formatRank(rank)` returns labels such as `Gold 2` or `Unranked`.
- `getRankTheme(rankTier)` returns UI colors and icon key.

Use five placement matches by default. During placement, matchmaking still uses numeric rating, but public surfaces show `Unranked`.

## Rating Update Plan

Move away from recomputing skill from lifetime aggregates after every queue request. Lifetime aggregates make early stats too sticky and cannot explain match-to-match rank movement.

At ranked match end, compute one rating update per eligible participant:

- Start from each participant's `competitiveRating`.
- Compute team average rating for red and blue.
- Compute expected result with an Elo-style formula.
- Score actual result as win = 1, draw = 0.5, loss = 0.
- Use a K factor that starts high during placement and settles down after more ranked games.
- Add a small capped performance modifier based on objective play and combat contribution relative to the match average.
- Apply a leaver penalty when a ranked participant leaves after match start and does not reconnect before match end.

Recommended initial tuning:

- Default rating: 1000.
- Provisional K factor: 48 for the first 10 ranked matches.
- Normal K factor: 32.
- Veteran K factor: 24 after 50 ranked matches.
- Top-tier K factor: 16 for Unemployed players to reduce volatility.
- Performance modifier cap: plus or minus 8 rating per match.
- Leaver penalty: additional minus 10, capped so a winning team leaver does not gain rating.
- Per-match delta clamp: minus 50 to plus 50.

Performance should reward winning first. The modifier should never make a loss positive or a win negative unless the leaver penalty applies.

Use the existing server-owned match ledger and persistence flow as the source of truth. Never accept client-submitted rank deltas.

## Data Model Plan

Extend users with ranked aggregate fields:

- `competitiveRating`
- `rankedGames`
- `rankedWins`
- `rankedLosses`
- `rankedDraws`
- `rankedPlacementsRemaining`
- `rankedPeakRating`
- `rankedLastMatchAt`

Extend persisted match participants with ranked snapshots:

- ranked eligibility flag
- rating before
- rating after
- rating delta
- visible rank before
- visible rank after
- leaver penalty flag

Add indexes for ranked leaderboard queries:

- ranked games greater than zero
- competitive rating descending
- ranked wins descending
- ranked games ascending
- user creation time ascending as a stable final tie-breaker

Backfill existing users with a one-time migration:

- Seed `competitiveRating` from the existing simplified matchmaking rating calculation.
- Seed `rankedGames` from existing completed games.
- Set placement remaining to zero for users with at least five completed games.
- Leave accounts with fewer than five completed games in placement.
- Preserve all existing score, level, and wager aggregates.

Because historical matches do not reliably distinguish Quick Play from custom play, mark the backfill as legacy-derived in migration notes and let future ranked changes come from ranked-eligible matches only.

## Server API Plan

Expose ranked data anywhere a player identity is already serialized:

- Auth user/session payloads include current rating, visible rank, placement state, peak rank, ranked record, and current division progress.
- Leaderboard responses can return a ranked leaderboard ordered by competitive rating.
- Personal stats responses include both total-score rank and competitive rank where both are useful.
- Quick Play ticket responses include player rank, player rating, target search rank, and placement state.

Update matchmaking ticket claims:

- Replace `skillRating` with `competitiveRating`.
- Replace coarse bucket IDs with rank division indexes or rank band IDs.
- Include placement state for display only.
- Keep ticket signing and short TTL behavior.

Version ticket claims so older clients fail clearly or are supported briefly during rollout.

## Matchmaking Plan

Replace coarse buckets like Rookie, Contender, Adept, Veteran, and Elite with rank-division matchmaking.

Queue selection should:

- Use numeric `competitiveRating` for distance.
- Prefer rooms whose average rating is closest to the joining player.
- Use rank division distance as the coarse filter.
- Prefer nearly full eligible rooms after rating distance.
- Expand allowed division distance as queue wait time increases.
- Never put ranked players into unranked custom lobbies through Quick Play.

Recommended initial expansion:

- 0 to 30 seconds: same division or adjacent division.
- 30 to 60 seconds: plus or minus 2 divisions.
- 60 to 90 seconds: plus or minus 4 divisions.
- After 90 seconds: plus or minus 6 divisions.

Room metadata should advertise:

- matchmaking mode
- ranked eligibility
- average competitive rating
- average visible rank
- search division floor and current expansion distance
- required human player count
- current human player count

The client should display rank labels, not raw rating, during matchmaking.

## Ranked Eligibility Plan

A match is ranked only when all of these are true:

- It was created through Quick Play.
- It reached the configured full human player count.
- It has no bots or development NPCs counted as participants.
- It was not private.
- It was not a custom wagered lobby.
- It reached a real game-end state.
- The server can identify authenticated human participants.

If eligibility is false, persist normal match stats as today but skip rating deltas.

Disconnected authenticated players remain eligible participants. Their team outcome still counts. Apply the leaver penalty only when the server can distinguish a real mid-match departure from a reconnect.

## Client State Plan

Add ranked fields to the user stats and matchmaking status models:

- visible rank tier and division
- rank label
- icon key
- theme colors
- placement remaining
- rating progress within current division
- last match rating delta when available

Lobby player records should carry public rank snapshots for display to other users. Avoid making the client fetch every other user individually.

Game player records and scoreboard rows should carry rank snapshots copied from authoritative lobby/game room state.

## UI Plan

Create reusable rank UI primitives:

- `RankIcon`: compact icon rendered from the rank icon key.
- `RankBadge`: icon plus label for lobby rows, scoreboard, and leaderboards.
- `RankProgress`: division progress bar for personal profile surfaces.
- `RankChangeSummary`: match-end delta display.
- `PlacementBadge`: `Unranked` state with placement count.

Display rank in these surfaces:

- Main lobby profile area: current rank badge near player name.
- Quick Play entry point: show current rank and placement state before queueing.
- Matchmaking screen: show `Searching near Gold 2` style copy, current player rank, estimated search expansion, and queue count.
- Lobby roster: show each authenticated player's rank badge.
- In-game scoreboard: show rank badges next to player names without crowding combat stats.
- Match summary: show rating delta, rank-up or division-up messaging, and placement progress.
- Stats page: make competitive rank prominent in the personal band and add a ranked leaderboard view ordered by rating.

Keep total score leaderboard available as a secondary view if the existing leaderboard remains useful. Do not silently relabel total-score rank as competitive rank.

## Rank Icon Plan

Use custom rank-specific SVG icons to match the existing inline SVG style in the client UI.

Icon direction:

- Plastic: simple cracked plate silhouette with muted gray-white material.
- Bronze: heavy shield or ingot mark with warm bronze tone.
- Silver: clean angular crest with cool metal tone.
- Gold: crown-like crest with gold highlights.
- Diamond: faceted crystal crest with bright cyan-white highlights.
- Unemployed: exaggerated top-tier crest using a briefcase or broken tie motif with high-contrast violet, white, and gold accents.

Implementation requirements:

- Icons must work at 16, 24, 40, and 72 pixel sizes.
- Icons must not depend on CSS filters for meaning.
- Icons need accessible labels when used without adjacent text.
- Theme tokens should come from the shared rank definitions so badges, progress bars, and leaderboard highlights stay consistent.
- Keep generated assets deterministic and committed with the UI code. If bitmap art is later desired, treat it as an enhancement after the SVG system lands.

## Implementation Slices

### 1. Shared Rank Definitions

Add the rank definition module, helper functions, and unit tests for threshold mapping, labels, progress, placement behavior, and division distance.

Acceptance criteria:

- Every rank from Plastic 1 through Unemployed 4 maps correctly.
- Boundary ratings map to the expected division.
- Placement users display as Unranked while still retaining numeric matchmaking rating.

### 2. Database And Backfill

Add the ranked fields, participant snapshots, indexes, and migration backfill.

Acceptance criteria:

- Existing users receive deterministic seeded ratings.
- Existing aggregate stats remain unchanged.
- New users default to 1000 rating and five placements remaining.

### 3. Rating Update Service

Create a server-owned rating service that consumes completed match participants and writes rating deltas in the same transaction as match persistence.

Acceptance criteria:

- Ranked-eligible matches update rating exactly once.
- Unranked matches skip rating updates.
- Duplicate persistence attempts cannot double-apply rating deltas.
- Leaver penalty is represented in participant snapshots.

### 4. Matchmaking Replacement

Update Quick Play ticket issuance, room metadata, and room selection to use competitive rating and rank division distance.

Acceptance criteria:

- Queue placement is based on numeric rating.
- Queue status and room metadata expose display-safe rank information.
- The old coarse bucket labels no longer appear in user-facing matchmaking UI.

### 5. Public Rank Serialization

Update auth/session, leaderboard, lobby, game, and matchmaking payloads with rank summaries.

Acceptance criteria:

- The current user sees their rank after sign-in.
- Other players' ranks appear from room state, not extra client-side user lookups.
- Guests and placement players render clear non-ladder states.

### 6. Rank UI Components

Build rank icon and badge primitives, then wire them into lobby, matchmaking, scoreboard, match summary, and stats surfaces.

Acceptance criteria:

- Every required surface has a rank badge or placement badge.
- Text fits in compact rows at desktop and mobile breakpoints.
- Rank icons remain legible at small sizes.
- The Stats page distinguishes competitive rank from total-score leaderboard rank.

### 7. Verification And Tuning

Add focused tests and non-browser verification:

- Shared rank helper unit tests.
- Server rating update tests.
- Match persistence tests covering ranked and unranked eligibility.
- Matchmaking ticket tests with versioned competitive claims.
- Leaderboard serialization tests.
- Typecheck and build for server/client packages.

Do not include browser testing in the implementation workflow. The user will handle browser QA.

## Rollout Notes

Land the shared model before UI wiring so server and client use the same labels and thresholds.

Keep the old simplified matchmaking calculation only as a migration seed and temporary fallback. New ranked movement should come from persisted match outcomes.

Gate ranked eligibility tightly at launch. It is easier to expand ranked coverage later than to repair polluted competitive ratings.

Log aggregate queue health by rating band after launch so thresholds and expansion timing can be tuned from real matchmaking behavior.

## Open Questions For Implementation

- Should placement rank be hidden from other users, or should others see `Unranked` with a placement badge?
- Should top-tier Unemployed 4 expose excess rating progress, or simply show max division progress as full?
- Should ranked queue require sign-in, or should guests be allowed to queue unranked into the same Quick Play pool with default provisional rating?
- Should total-score leaderboard remain the default Stats page tab, or should competitive leaderboard become the default once ranks launch?
