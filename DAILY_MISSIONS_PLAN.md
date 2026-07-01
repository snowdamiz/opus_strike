# Daily Missions Plan

## Reader And Goal

Reader: an implementation engineer adding admin-configurable daily missions to Slop Heroes.

Post-read action: implement a daily mission system where admins can configure one or more missions per day, players can see active missions in the top-left lobby UI, and completed missions grant SOL, game-token, or hero-skin rewards safely.

## Confirmed Current State

- There is no existing mission, quest, challenge, or daily objective system in the codebase.
- The admin console already has authenticated overview and mutation flows with CSRF protection. It currently organizes operational controls into Overview, Live Ops, Players, Economy, Infrastructure, and Anti-Cheat sections.
- The existing reward ledger pays SOL lamports for ranked daily drip, objective bounties, and weekly leaderboard rewards. It uses idempotency keys, pending/processing/paid statuses, payout rows, treasury reserve checks, and retryable transfers.
- The game token is configured centrally and is already used by token-gated features and the skin shop payment flow. Outbound SPL-token rewards are not implemented yet.
- Hero skin ownership already exists and supports `free`, `paid`, `admin_grant`, and `event` entitlement sources. Ranked founder rewards already demonstrate transactional skin grants.
- Match persistence stores authoritative per-player match stats: hero played, kills, deaths, assists, flag captures, flag returns, score, experience, outcome, ranked eligibility, and leave state.
- The server kill hook has both killer and victim player objects at the moment of death, but persistence currently collapses that to simple kill and assist counts. Victim hero, killer hero per kill, ability kill, flag-carrier kill, and streak details are not persisted.
- The CTF objective hooks already increment authoritative flag capture and flag return counts.
- The main lobby has an absolute top navigation bar with the brand in the top-left. The in-game HUD should not display daily missions.

## Product Requirements

- Admins can create, edit, enable, disable, schedule, and order multiple daily missions.
- Missions reset on a daily UTC boundary by default, matching the current reward service day-key pattern.
- Missions can have one or more criteria. Initial criteria should support the levers already available from persisted match data, then expand to event-level criteria after new instrumentation lands.
- Rewards can include:
  - SOL lamports.
  - The game token in SPL token base units.
  - One or more hero skins from the skin catalog.
- Rewards are granted once per user per mission per day.
- Missions appear in the top-left of the lobby only as floating UI, not as cards. The treatment should feel like game lobby chrome: compact rows, thin rails, icons, progress bars, no boxed card panels.
- Mission progress and completion must be server-authoritative. The client can preview and display progress, but must not decide completion or grant rewards.

## Mission Levers

Phase-one levers that can be implemented from current persisted match data:

- Complete matches.
- Win matches.
- Get eliminations.
- Get assists.
- Capture flags.
- Return flags.
- Earn score.
- Earn experience.
- Play a specific hero.
- Get eliminations while playing a specific hero.
- Complete or win ranked matches.
- Require the player to finish the match and not leave before the end.
- Require a minimum match duration.
- Require a clean match integrity result.

Levers that need small persistence additions:

- Filter by gameplay mode. The room has gameplay mode at runtime, but match persistence does not currently store it.
- Get eliminations against a specific hero.
- Get eliminations with a specific ability.
- Kill the enemy flag carrier.
- Capture while playing a specific hero if the criterion needs event-level proof rather than match-level hero played.

Levers to defer until deeper gameplay telemetry exists:

- Damage dealt.
- Healing done.
- Headshots or precision hits.
- Multi-kills and kill streaks.
- Zone/safe-zone movement objectives.
- Powerup pickups.
- Ability-specific utility such as shielding, rooting, reviving, or pulling.

## Data Model

Add mission configuration, progress, and reward audit tables instead of embedding missions inside the existing reward settings singleton.

Recommended models:

- `DailyMissionDefinition`
  - Stable id.
  - Display name.
  - Short description.
  - Enabled flag.
  - Sort order.
  - Active start and end timestamps.
  - Daily reset policy, initially UTC.
  - Criteria JSON with a server-validated discriminated-union schema.
  - Reward bundle JSON with server-validated reward items.
  - Eligibility JSON for match mode, gameplay mode, ranked-only, min duration, clean-integrity-only, and leaver handling.
  - Created/updated admin ids and timestamps.
  - Optional archived timestamp for operational history.

- `UserDailyMissionProgress`
  - User id.
  - Mission id.
  - Day key.
  - Progress JSON keyed by criterion id.
  - Completed timestamp.
  - Claimed/granted timestamp.
  - Last contributing match id.
  - Unique constraint on user id, mission id, and day key.

- `MissionRewardGrant`
  - User id.
  - Mission id.
  - Day key.
  - Reward type: SOL, game token, or skin.
  - Amount base units for token-like rewards.
  - Skin id for skin rewards.
  - Status: pending, processing, granted, failed, canceled.
  - Idempotency key.
  - Linked SOL reward id or token payout id when applicable.
  - Metadata for match id, criteria snapshot, and admin mission version.

Extend existing persistence where needed:

- Add a mission reward kind for SOL grants so SOL mission payouts can reuse the current reward ledger, payout grouping, treasury reserve checks, and retry path.
- Add a token payout path for outbound SPL game-token transfers. This should reuse the central game-token configuration and should not introduce per-feature token config.
- Add gameplay mode to persisted match rows so missions can target CTF, team deathmatch, and battle royale without inference.
- Add a compact match event aggregate for kill details. A normalized event table is preferable to bloating participant rows:
  - Match id.
  - Killer user id and player session id.
  - Victim user id and player session id.
  - Killer hero id.
  - Victim hero id.
  - Ability id and damage type when known.
  - Victim had flag boolean.
  - Occurred timestamp.

## Criteria Shape

Use typed JSON instead of ad hoc strings. Validate it on the server before saving from admin.

Example criteria:

```json
{
  "mode": "all",
  "items": [
    {
      "id": "elims",
      "type": "eliminations",
      "target": 10
    },
    {
      "id": "ctf",
      "type": "flag_captures",
      "target": 2
    }
  ]
}
```

Supported initial criterion types:

- `matches_completed`
- `wins`
- `eliminations`
- `assists`
- `flag_captures`
- `flag_returns`
- `score`
- `experience`
- `play_hero`
- `eliminations_as_hero`

Supported after event aggregate lands:

- `eliminations_against_hero`
- `eliminations_with_ability`
- `flag_carrier_eliminations`

Criteria should support `all` semantics first. Add `any` only if the admin UI has a clear need for branching missions.

## Reward Shape

Example reward bundle:

```json
{
  "items": [
    {
      "type": "sol",
      "amountLamports": "50000"
    },
    {
      "type": "game_token",
      "amountBaseUnits": "100000",
      "symbol": "SLOP"
    },
    {
      "type": "skin",
      "skinId": "blaze.golden"
    }
  ]
}
```

Rules:

- Store amounts as strings in API payloads to preserve BigInt safety.
- Resolve game-token symbol and mint server-side from the central config. Admin UI can display the symbol but should not save token configuration.
- Validate skin ids against the shared skin catalog.
- Grant skin rewards with the `event` entitlement source.
- Generate deterministic idempotency keys:
  - `mission:<dayKey>:<missionId>:<userId>:sol`
  - `mission:<dayKey>:<missionId>:<userId>:game_token`
  - `mission:<dayKey>:<missionId>:<userId>:skin:<skinId>`

## Server Flow

1. Admin saves mission definitions through the admin API.
2. Client fetches active missions for the signed-in user from a player-facing missions API.
3. Match finalization persists the match and participant rows.
4. After successful match persistence, the mission service evaluates all active missions for each eligible participant.
5. The mission service upserts the user's progress row for that day.
6. When all criteria are complete, the service creates reward grant rows with deterministic idempotency keys.
7. SOL rewards create a mission-completion row in the existing player reward ledger and reuse the existing payout worker.
8. Skin rewards upsert user skin ownership transactionally and mark the mission reward grant as granted.
9. Game-token rewards create pending token payout rows until the outbound SPL-token transfer worker is implemented.
10. The player-facing missions API returns active missions, progress, completion state, and grant status.

Keep mission settlement behind the same trust gates as current rewards:

- Clean integrity result required by default.
- Ranked-only missions require final ranked eligibility.
- Ignore bots and NPCs for player mission credit.
- Ignore users who left before match end unless the mission explicitly allows partial progress.
- Enforce min duration.
- Use idempotency everywhere because match finalization and reward workers can retry.

## Admin UI Plan

Add a Missions section to the admin console navigation. Put it between Live Ops and Economy because mission scheduling is live-ops behavior, while mission rewards depend on economy plumbing.

Missions section views:

- Today
  - Shows active missions for the current UTC day.
  - Displays mission order, enabled state, criteria summary, reward summary, and completion/grant counts.
  - Supports quick enable/disable and reorder.

- Library
  - Lists reusable mission definitions.
  - Supports duplicate, edit, archive, and schedule.

- Editor
  - Mission name and short display text.
  - Enabled toggle.
  - Active start/end.
  - Sort order.
  - Eligibility controls: match mode, gameplay mode, ranked-only, clean-integrity-only, min duration, leaver policy.
  - Criteria builder with add/remove rows:
    - Lever select.
    - Target count input.
    - Hero selector when the lever supports hero filters.
    - Ability selector after ability-kill instrumentation lands.
  - Reward builder with add/remove rows:
    - SOL amount.
    - Game-token amount.
    - Skin selector.
  - Guardrails: per-user once per day, optional global completion cap, budget preview, warning if token/SOL payout infrastructure is not configured.

- Audit
  - Recent admin edits.
  - Failed reward grants.
  - Pending token/SOL payouts.

Use the existing admin fetch and mutation pattern. Extend the overview payload with a compact missions summary, and add dedicated list/detail endpoints if the payload becomes large.

## Player Lobby UI Plan

- Add a top-left floating mission cluster below the brand/nav area, aligned to the same left edge as the lobby chrome.
- It should not be a card. Use compact lobby rows with a thin accent rail, mission icon, title, progress text, and a small horizontal progress bar.
- Show up to three active missions by default. If there are more, show the highest priority incomplete missions first and collapse the rest behind a compact count.
- Use mission reward icons/chips sparingly: SOL, game-token ticker, and skin rarity/hero glyph.
- On mobile, keep the cluster under the top nav and cap width so it does not collide with play controls.
- Do not render daily missions in the in-match HUD.

Suggested visual treatment:

- Transparent background with backdrop blur only where needed for legibility.
- Left accent line per mission.
- Small objective icon.
- Uppercase micro-label for "Daily".
- Numeric progress like `7/10`.
- Thin progress bar under the label.
- Completion state swaps progress text for `Done` and reward status.

## APIs

Admin API:

- `GET /admin/api/missions`
- `POST /admin/api/missions`
- `POST /admin/api/missions/:missionId`
- `POST /admin/api/missions/:missionId/archive`
- `POST /admin/api/missions/reorder`

Player API:

- `GET /missions/daily`
  - Requires auth.
  - Returns active missions for current UTC day plus user progress and reward grant status.

Optional realtime messages:

- `missionProgress`
  - Sent after match-end settlement or after the user returns to lobby.
  - Not required for phase one if the lobby refetches after game end.

## Implementation Slices

1. Mission domain and validation
   - Add shared mission criterion and reward types.
   - Add server validators for admin payloads.
   - Add unit tests for criteria parsing and reward validation.

2. Persistence
   - Add mission definition, progress, reward grant, and optional token payout tables.
   - Add mission reward enum value for SOL ledger reuse.
   - Add gameplay mode to match persistence.

3. Server mission service
   - Load active missions for a day.
   - Evaluate match participant stats against criteria.
   - Upsert progress idempotently.
   - Create reward grants on completion.
   - Grant skins and SOL rewards.
   - Leave game-token grants pending until token payouts exist.

4. Event-level kill aggregate
   - Extend kill recording to persist killer/victim hero and ability details.
   - Enable specific hero kill and ability kill criteria.

5. Admin UI
   - Add Missions nav section.
   - Build Today, Library, Editor, and Audit views.
   - Wire admin API methods into the existing admin console hook.

6. Player API and client state
   - Add authenticated daily mission fetch.
   - Add a small mission store or query hook.
   - Refetch on login, lobby entry, and game end.

7. Floating mission UI
   - Add shared mission tracker component.
   - Render in the main lobby top-left.
   - Keep the treatment floating and non-card-like.

8. Game-token payout extension
   - Add outbound SPL-token transfer worker.
   - Reuse central game-token config.
   - Add associated token account creation.
   - Add retry and manual-review states.
   - Enable game-token mission rewards only when configured.

## Verification Plan

Do not use browser testing for this project unless the user explicitly asks.

Recommended verification:

- Run TypeScript checks for client, server, and shared packages.
- Run server tests for mission validation, progress evaluation, idempotent completion, SOL reward grants, skin grants, and failed payout retry behavior.
- Run existing match persistence and player reward tests.
- Run client tests for mission store and formatting helpers if added.
- Run admin component tests only if the project already has a suitable React test setup.
- Manually inspect the UI in the browser only by the user, per project instructions.

## Open Decisions

- Whether daily reset must be UTC only or admin-configurable later.
- Whether missions should be global for all players or segmentable by rank/new-player status.
- Whether completed rewards should auto-claim immediately or require an explicit claim button.
- Whether custom/practice matches should ever count. The safe default is no for rewarded missions.
- Whether game-token rewards must ship in the first implementation or can be disabled until outbound SPL-token payouts are complete.
