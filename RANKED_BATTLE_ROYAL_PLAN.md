# Ranked Battle Royal Conversion Plan

## Reader And Action

Reader: an engineer implementing the ranked-mode change.

Post-read action: convert Ranked from Capture the Flag to Battle Royal, enable ranked bot-filled matches with as few as one real player, improve ranked bot intelligence, and replace the current red-vs-blue ranked rating strategy with a Battle Royal ranked-points model.

## Current Code Facts Checked

- Shared gameplay rules currently mark Capture the Flag and Team Deathmatch as ranked-enabled, while Battle Royal is ranked-disabled.
- Ranked matchmaking settings currently force ranked into the default gameplay mode, default perspective, and manual bot fill.
- Signed matchmaking tickets currently preserve gameplay mode and bot fill only for quick play. Ranked tickets normalize back to the default gameplay mode.
- Lobby creation, request-join checks, ranked room naming, party launch, client ranked play, queue status, and matchmaking UI all contain ranked-default-mode assumptions.
- Matchmaking bot fill currently only applies to quick play. Ranked auto-start waits for a full ranked roster and does not use the quick-play bot-fill path.
- Ranked eligibility allows bots in lobby assignments, but the candidate check and queue sizing are still built around a full participant roster. Final ranked persistence only rates durable human participants.
- Ranked rating currently uses a two-team Elo-style win/loss calculation with CTF-weighted performance modifiers.
- Battle Royal already has 33-player, 11-team rules, BR teams, BR map generation, drop ship deployment, safe zone, downed/revive behavior, and last-team-alive match end.
- Bot AI already has `easy`, `normal`, `hard`, and a stronger streamer showcase skill profile. It also has non-CTF elimination tactics, but ranked BR needs survival, rotation, safe-zone, revive, and bot-fill-specific tuning.
- Persisted match participant rows currently store rating deltas, but not BR placement or a ranked-points breakdown.

## Goals

- Ranked always queues and launches Battle Royal.
- Ranked allows one or more eligible humans and fills the rest of the 33-player BR roster with bots.
- Ranked party size follows BR squad size, not the old CTF team size.
- Ranked bots are meaningfully smarter than normal bot fill.
- Ranked rating uses placement, eliminations, entry cost, and bot-fill quality rather than red-vs-blue Elo.
- Bot-filled ranked matches can progress rank, but bot-heavy matches are capped so they cannot outpace human-heavy ranked matches.
- Legacy CTF-ranked assumptions are removed, not left as alternate dead paths.

## Non-Goals

- No browser testing. User will handle browser validation.
- No worktree or branch setup.
- No new ranked economy or token-gate model beyond preserving the existing ranked token check.
- No full redesign of the rank badge UI. Only copy/status changes needed for BR ranked should be included.

## Proposed Ranked Strategy

Keep using the existing `competitiveRating` field as the visible ranked-points total for this change. Add a Battle Royal calculation path and preserve the current two-team calculation only if non-BR ranked is deliberately kept for admin/dev use. If Ranked is exclusively BR, remove the old ranked CTF calculation path after migration tests pass.

### Ranked Points Inputs

For each durable human participant:

- team placement among active BR teams
- match size and active team count
- human participant count
- bot participant count
- kills and assists against humans
- kills and assists against bots
- whether the player left before their team was eliminated or the match ended
- current division index or tier for entry cost
- anti-cheat ranked hold status

Bots never receive rating updates.

### Placement Points

Use an Apex-like placement table for 11 BR squads:

| Placement | Base RP |
| --- | ---: |
| 1 | 125 |
| 2 | 85 |
| 3 | 60 |
| 4 | 40 |
| 5 | 30 |
| 6 | 20 |
| 7 | 10 |
| 8 | 0 |
| 9 | -5 |
| 10 | -10 |
| 11 | -15 |

Scale this table by active team count for smaller internal tests, but ranked production should still fill to 11 squads.

### Combat Points

Combat points are reduced for bot-heavy matches.

- Human kill: 14 RP
- Human assist: 7 RP
- Bot kill: 5 RP
- Bot assist: 2 RP
- Combat RP cap before quality scaling: 75
- Placement multiplier:
  - 1st: 1.5
  - 2nd-3rd: 1.25
  - 4th-5th: 1.0
  - 6th-7th: 0.75
  - 8th or worse: 0.5

Formula:

```text
combatRp = min(75, round(rawCombatRp * placementMultiplier))
```

### Entry Cost

Entry cost makes higher ranks harder to climb through bot-filled lobbies.

| Rank Band | Entry Cost |
| --- | ---: |
| Plastic | 0 |
| Bronze | 6 |
| Silver | 14 |
| Gold | 26 |
| Diamond | 40 |
| Unemployed | 58 |

Use the player's pre-match division to derive the rank band.

### Bot-Fill Quality Multiplier

Use a quality multiplier so one-human ranked BR is valid but slower than human-heavy ranked.

```text
humanShare = humanParticipants / max(1, totalParticipants)
qualityMultiplier = clamp(0.45 + humanShare * 0.55, 0.45, 1.0)
grossRp = round((placementRp + combatRp) * qualityMultiplier)
delta = grossRp - entryCost
```

Positive delta caps:

| Human Participants | Max Positive Delta |
| --- | ---: |
| 1 | 35 |
| 2-5 | 60 |
| 6-15 | 90 |
| 16+ | 125 |

Clamp final delta to `[-75, positiveCap]`.

This lets a single real player gain rank by winning and playing well, while preventing bot-only farming from becoming the fastest ranked path.

### Leavers And Held Outcomes

- If a player leaves before their team is eliminated or before match end, they cannot gain RP.
- Apply at least `entryCost + 25` as a penalty for early leavers, clamped by the normal negative floor.
- Keep the existing anti-cheat hold flow. Held outcomes should persist match and participant rows without applying rating until review resolution.

## Implementation Slices

### 1. Shared Ranked Mode Constants

- Add a shared ranked gameplay-mode constant that resolves to Battle Royal.
- Mark Battle Royal as ranked-enabled.
- Update shared tests that currently assert Battle Royal ranked is disabled.
- Update party member limits so ranked uses BR squad size.
- Remove ranked fallbacks that infer Ranked means the default CTF gameplay mode.

Acceptance:

- Ranked gameplay mode resolves to Battle Royal in shared rules.
- Ranked party size is 3.
- No ranked path depends on Capture the Flag as a default.

### 2. Matchmaking Tickets And Queue Settings

- Update matchmaking settings to preserve ranked gameplay mode as Battle Royal.
- Make ranked queue keys include ranked BR identity and region.
- Make ranked tickets carry Battle Royal gameplay mode, ranked bot-fill mode, and default ranked perspective.
- Update ticket verification to accept ranked BR claims instead of normalizing them back to the default gameplay mode.
- Update queue status to return ranked gameplay mode and bot-fill mode so the client can display BR ranked correctly.

Acceptance:

- A ranked ticket verifies with Battle Royal gameplay mode.
- Ranked queue status reports Battle Royal and the ranked bot-fill policy.
- Matchmaking metadata comparison can match ranked BR lobbies.

### 3. Client And Party Entry

- Update solo ranked play to request/join a ranked BR lobby.
- Update party ranked launch to use Battle Royal gameplay mode and BR squad limit.
- Set ranked bot fill to the ranked policy, not manual.
- Update matchmaking screen copy from "ranked squad" and "players queued" to BR-friendly language that accounts for bots.
- Remove "Bot fill does not apply to ranked" UI logic. Ranked bot fill should be automatic, not player-toggleable.

Acceptance:

- Solo ranked starts a ranked BR queue.
- Party ranked starts a ranked BR queue with up to 3 human party members.
- The client local matchmaking state matches server-ranked BR settings.

### 4. Ranked Bot Fill In Lobby

- Introduce a ranked bot-fill predicate separate from quick-play toggle state.
- Ranked queue should wait only for expected party humans, then fill remaining BR slots with bots.
- Fill the human squad first, then distribute remaining bots across open BR squads.
- Use hard or ranked-profile bots for ranked fill.
- Keep host bot controls disabled in ranked.
- Ensure ranked candidate checks require every human to have a valid ranked ticket, while allowing bot assignments to fill the roster.

Acceptance:

- One eligible human can enter ranked and launch a 33-player BR match with bots.
- Ranked parties launch once all expected party humans join.
- Bots are allowed in ranked eligibility, but humans without ranked tickets are not.

### 5. Ranked BR Placement Tracking

- Add a BR placement tracker in the game room runtime.
- Track active BR teams after deployment begins.
- When a team no longer has alive or downed contestants, record its elimination time and placement.
- At match end, assign remaining team placement, including the winner.
- Attach placement to human participant snapshots used by summaries and persistence.
- Preserve current win/loss outcome for broad stats, but use placement for ranked RP.

Acceptance:

- A ranked BR match can produce each human participant's team placement.
- Single-human-plus-bots match assigns a valid placement to the human team.
- Downed players count as contesting until eliminated.

### 6. Ranked BR Rating Service

- Add a BR-specific ranked update function.
- Dispatch rating updates by gameplay mode or score model.
- Keep the current rank aggregation outputs: rating before, rating after, delta, visible ranks, ranked games, placements remaining, and peak rating.
- Include the new placement/combat/entry/quality calculation in tests.
- Remove CTF-only performance modifiers from the BR path.

Acceptance:

- BR ranked deltas are based on placement, combat, entry cost, bot-fill quality, and leaver status.
- Bot kills are worth less than human kills.
- One-human matches can gain RP but respect the single-human positive cap.
- Held ranked outcomes can be applied later with the same BR formula.

### 7. Persistence And Audit Fields

- Add participant-level persistence for BR placement and ranked calculation breakdown.
- Suggested fields:
  - `placement`
  - `rankedPlacementPoints`
  - `rankedCombatPoints`
  - `rankedEntryCost`
  - `rankedQualityMultiplier`
  - `rankedRulesVersion`
- If the schema should stay smaller, use `placement` plus a `rankedBreakdown` JSON field.
- Update match persistence and held-outcome application to write the same breakdown.

Acceptance:

- Post-match records explain why a ranked BR delta happened.
- Existing ranked history still reads correctly for old CTF-ranked rows.

### 8. Ranked Bot Intelligence

- Add a ranked BR bot profile, preferably by `botProfileId` prefix rather than expanding public `BotDifficulty`.
- Base it above `hard`, below or near the streamer showcase profile.
- Add BR-specific bot facts to the blackboard:
  - safe-zone center and next zone
  - distance to safe zone
  - team placement pressure
  - nearby downed ally
  - nearby revive threat
- Add BR-specific intents:
  - rotate to safe zone
  - hold safe-zone edge
  - revive teammate
  - finish downed enemy when safe
  - disengage from bad third-party fights
- Ensure bot drop behavior chooses plausible team drop timing and landing spread.
- Keep planning LOD, but make bots near humans, in final rings, or in combat critical-priority.

Acceptance:

- Ranked bots fight, rotate, revive, and survive better than normal bots.
- Single-human ranked matches do not feel like passive target practice.
- Bot planning remains bounded for 32 bots.

### 9. Legacy Removal

Remove these legacy assumptions as part of implementation:

- Ranked implies Capture the Flag/default gameplay mode.
- Ranked disables bot fill.
- Ranked queues require a full human roster.
- Ranked rating is always red team versus blue team.
- Ranked performance score is flag-capture weighted.
- Ranked UI says bot fill does not apply.

Keep only deliberate compatibility code for old persisted rows or admin/debug-only non-BR matches.

## Test Plan

Do not test in the browser.

Run focused automated tests after each slice:

- Shared rank and BR mode tests.
- Matchmaking settings tests.
- Matchmaking ticket tests.
- Lobby matchmaking bot-fill tests.
- Lobby game-start tests.
- Match ledger tests.
- Match persistence tests.
- Match summary tests.
- Ranking service tests.
- Ranked held-outcome tests.
- Bot AI tests.
- Battle Royal safe-zone and drop tests.
- Typecheck for server, shared, and client.

Add new tests for:

- Ranked ticket carries Battle Royal gameplay mode.
- Ranked queue status includes BR and ranked bot fill.
- One human ranked lobby fills to 33 participants with bots.
- Ranked party of 2 or 3 fills squad slots and remaining BR teams.
- Ranked candidate rejects humans without ranked tickets.
- BR placement tracker produces correct placements for eliminated teams.
- BR ranked formula applies placement, bot kill reduction, entry cost, quality multiplier, and positive caps.
- Early leaver in BR cannot gain RP.
- Held ranked BR outcome applies the same formula after review.
- Ranked bot profile is stronger than hard on reaction, aim error, ability cadence, and planning cadence.

## Rollout Order

1. Add shared ranked BR constants and update tests.
2. Update tickets, queue settings, party launch, and client ranked entry.
3. Enable ranked bot fill in lobby and make one-human ranked launch work.
4. Add BR placement tracking and persist placement data.
5. Add BR ranked-points calculation and wire summaries/persistence.
6. Add ranked BR bot profile and BR-specific bot tactics.
7. Remove confirmed legacy CTF-ranked branches.
8. Run focused automated tests and typecheck.

## Open Decisions

- Whether ranked BR should start immediately after one human joins or wait a short grace period for other humans before bot fill. Recommendation: wait 10 seconds for solo queue, no wait for party once expected humans arrive.
- Whether old CTF-ranked matches should remain visible in history with their old deltas. Recommendation: keep old persisted rows readable, but remove CTF ranked from new matchmaking.
- Whether to expose the RP breakdown in post-match UI immediately. Recommendation: persist it first, add UI after the server behavior is stable.

## Reader-Test Notes

A fresh implementer should be able to act from this plan by changing ranked mode constants first, then following the matchmaking, lobby, ranking, persistence, bot AI, and test slices in order. The highest-risk gap is BR placement tracking because the current ranked rating service has no placement input; that must land before replacing the rating formula.
