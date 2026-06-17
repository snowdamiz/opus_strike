# Battle Royal Mode Plan

## Reader And Action

This plan is for an internal engineer who has not been part of the Battle Royal discussion. After reading it, they should be able to implement the mode end to end while preserving the existing Capture the Flag and Team Deathmatch modes.

## Goal

Add a new gameplay mode named **Battle Royal** with deterministic large-map generation, optimized runtime performance, and support for up to 30 combat players. Battle Royal supports up to 10 teams with a maximum of 3 players per team. A match ends when only one team has any non-eliminated players remaining.

Use `battle_royal` as the internal gameplay mode id unless product naming changes before implementation.

## Current Constraints

The existing codebase is strongly shaped around two-team arena modes:

- Gameplay modes currently cover Capture the Flag and Team Deathmatch only.
- Shared team typing, lobby assignment, spawn planning, match summaries, scoring, flags, UI, voice, and several combat helpers assume only `red` and `blue`.
- Existing map generation is a CTF semantic arena pipeline with red and blue bases, flags, mirrored spawn clusters, and a `small`, `medium`, `large` size set where `large` is still arena-scale.
- The client already has useful large-world foundations: prepared map caching, region batching, async mesh generation, progressive reveal, terrain culling, map warmup, minimap projection, and world dressing budgets.
- The server already has useful scalability foundations: spatial indexing, player visibility interest, packed transform replication, low-frequency vitals, room load snapshots, tick profiling, and capacity admission.
- Capacity math currently treats a full match as the default 8-player match, so 30-player Battle Royal rooms must be weighted differently.

## Mode Definition

Battle Royal v1 should behave as follows:

- Maximum combat players: 30.
- Maximum team count: 10.
- Maximum players per team: 3.
- Team sizes allowed: 1, 2, or 3 players per team.
- Victory condition: last team with an alive player wins.
- Respawn behavior: no automatic respawns after the match enters active play.
- Downed/dead behavior: eliminated players become spectators or remain in a dead spectating state until match end.
- Objective pressure: add a shrinking safe zone so large maps resolve into fights instead of long chases.
- Existing hero selection and hero abilities remain the core loadout model for v1.
- Existing powerups may be reused, but Battle Royal placement must use a mode-specific distribution.
- Ranked and wager behavior should be disabled for Battle Royal until scoring, integrity, payout, and rating rules are intentionally designed for it.

## Architecture Direction

### 1. Mode Rules Must Become Data Driven

Create a shared gameplay-mode rules layer that owns mode-specific values:

- Display label.
- Maximum players.
- Maximum team size.
- Maximum team count.
- Score model.
- Respawn policy.
- Match-end policy.
- Map family and map profile.
- Whether flags, team scores, safe zone, powerups, bots, ranked, wagers, and observers are enabled.
- Capacity weight or expected room cost.

Existing CTF and TDM should be represented through the same rules layer. Do not leave a new Battle Royal special case beside legacy two-team constants. Once mode rules are in place, remove duplicated constants that were only serving the old two-mode shape.

### 2. Generalize Teams Without Breaking Arena Modes

Introduce a team id model that can represent both arena teams and Battle Royal teams. Preserve `red` and `blue` as valid ids for the existing modes, but do not keep shared gameplay logic typed to only those two ids.

Required changes:

- Add a team catalog with 10 Battle Royal team ids, labels, colors, and compact UI names.
- Replace red/blue-only count helpers with generic team-count helpers.
- Replace winner helpers that compare only red and blue scores with mode-aware winner calculation.
- Replace hero-lock maps keyed only by red/blue with maps keyed by team id.
- Replace spawn planning structures keyed only by red/blue with generic team spawn clusters.
- Update friendly-fire, assists, target filtering, visibility, voice, and minimap teammate checks to compare generic team ids.
- Keep CTF flag structures red/blue-specific only inside CTF-specific rules and adapters.

Cleanup gate: after generic team utilities are adopted, remove obsolete red/blue helper variants unless they are deliberately scoped to CTF.

### 3. Refactor Map Generation Into Reusable Profiles

The existing procedural map generator should be split into reusable stages and mode-specific profiles instead of copying the CTF generator.

Create a procedural map profile abstraction with:

- Mode/family id.
- Size profile.
- Boundary generation.
- Spawn placement.
- Objective placement.
- Route graph requirements.
- Protected zones.
- Terrain profile.
- Structure placement rules.
- Powerup placement rules.
- Performance budgets.
- Preview metadata.

Then migrate the current CTF pipeline to a `ctf_arena` profile and implement Battle Royal as a separate `battle_royal_large` profile. The current CTF generator becomes a compatibility wrapper only while callers are migrated. After callers use the profile-based API, remove the wrapper if it is no longer needed.

Battle Royal map generation should not overload the existing arena `large` size. Add mode-specific sizing metadata so arena maps keep their current scale while Battle Royal can use a much larger footprint.

## Battle Royal Map Requirements

Battle Royal maps should be built for 30 players and 10 teams:

- Use a larger playable footprint than existing arena maps.
- Generate 10 spawn clusters distributed around the outer third of the map.
- Each spawn cluster must support 3 players without overlap.
- Avoid giving any team a direct line of sight into another team spawn at match start.
- Place high-value landmarks near the center and medium-value landmarks between outer spawns and the center.
- Terrain should support long traversal without becoming flat: ridges, valleys, cover bands, ramps, caves or cut-throughs, and vertical landmarks.
- Use large boundary shapes that support the safe-zone shrink path.
- Preserve deterministic generation by seed, theme, profile, size, and generator version.
- Include diagnostics that report spawn safety, team separation, route connectivity, solid block count, renderable chunk count, collider count, and generation time.

Battle Royal terrain should favor sparse, readable detail over dense block noise. Large maps need fewer high-cost decorative structures per square meter than arena maps.

## Optimization Requirements

Large maps make performance part of the feature, not polish.

### Generation And Cache

- Include mode id and profile id in map cache keys.
- Keep a lightweight manifest path for server simulation and map vote previews.
- Generate heavy mesh/collider data lazily or in bounded chunks where possible.
- Cap solid blocks, renderable chunks, colliders, world dressing instances, and generated structures through profile budgets.
- Add Battle Royal diagnostics to map-generation tests so large-map regressions are visible.
- Avoid keeping several full Battle Royal maps in memory at once. Use a smaller LRU budget for Battle Royal than arena maps.

### Client Rendering

- Reuse the existing prepared-map cache, region batching, async mesh worker, progressive reveal, terrain culling, and world dressing budget.
- Tune region size and culling distance for Battle Royal instead of using the arena defaults blindly.
- Keep map vote previews blueprint-first or thumbnail-first. Do not synchronously render multiple full Battle Royal maps in the vote screen.
- Make minimap rendering safe for much larger boundaries and safe-zone overlays.
- Ensure terrain warmup reports progress by profile and does not block the main thread for large maps.
- Add a fallback quality profile that lowers dressing density, shadows, reflection intensity, generated regions per frame, and terrain draw distance for Battle Royal.

### Server Runtime

- Make room capacity admission mode-aware so one 30-player Battle Royal room is weighted more heavily than one 8-player arena room.
- Confirm player spatial index cell size and candidate queries still work for 30 players over a larger map.
- Keep transform, vitals, and interest replication bounded through spatial/visibility filters.
- Extend visibility interest rules to generic teams and review max perception distance for larger maps.
- Ensure line-of-sight cache limits cannot balloon under 30-player fights.
- Keep bot tactics disabled for Battle Royal v1 unless Battle Royal-specific tactics are implemented.
- Add room load metadata for mode, player cap, team count, map profile, renderable chunk count, collider count, tick p95/p99, interest checks, and stream bytes.

Performance target: a full 30-player Battle Royal room should stay under the existing server tick budget on target deployment hardware, with p99 room tick time below the 70 percent tick-budget target used by current capacity logic.

## Implementation Milestones

### Milestone 1: Baseline And Rules Extraction

- Capture current arena behavior with focused tests around mode config, team assignment, spawn assignment, scoring, game end, lobby limits, map vote payloads, and match summaries.
- Add the shared gameplay-mode rules layer.
- Move CTF and TDM constants into the rules layer.
- Replace direct default-config usage in lobby, game room, matchmaking, and capacity code with mode rules.
- Verify CTF and TDM behavior stays unchanged.

### Milestone 2: Generic Team Model

- Add generic team ids and a Battle Royal team catalog.
- Refactor lobby roster counting, team selection, bot assignment, hero locks, game-start assignment, voice team routing, combat target filtering, minimap teammate selection, and UI grouping to use generic team ids.
- Keep red/blue presentation for arena modes through the team catalog rather than hardcoded branches.
- Remove old red/blue-only utility code after the generic path is adopted.

### Milestone 3: Battle Royal Lobby And Match Start

- Expose Battle Royal in custom game creation.
- Set mode rules to 30 max combat players, 10 max teams, and 3 players per team.
- Add auto-assignment that fills teams up to 3 while keeping parties together if party metadata exists.
- Update lobby UI to show up to 10 compact team panels for Battle Royal.
- Disable ranked, wagered, and bot-fill paths for Battle Royal v1.
- Ensure game-start payloads include generic team assignments and Battle Royal map profile data.

### Milestone 4: Battle Royal Server Rules

- Add Battle Royal phase behavior and no-respawn elimination.
- Add alive-team tracking.
- End the match when one team remains alive, or declare no contest/draw when no teams remain.
- Add safe-zone state: center, radius, next radius, phase timings, damage amount, and warning state.
- Apply safe-zone damage on the server using existing damage infrastructure where possible.
- Broadcast safe-zone state through match snapshots or a dedicated lightweight message.
- Ensure match summaries and persistence can represent Battle Royal winner and participant outcomes.

### Milestone 5: Reusable Map Generator

- Extract reusable procedural generation stages from the current arena generator.
- Add a profile-driven generation entry point.
- Migrate the CTF generator to the profile entry point.
- Add Battle Royal map profile definitions, performance budgets, diagnostics, and previews.
- Generate 10 spawn clusters, large terrain, central landmarks, route graph, safe-zone-compatible boundaries, and Battle Royal powerup distribution.
- Update server and client map runtime to request maps by mode/profile instead of only seed, theme, and arena size.
- Remove temporary compatibility wrappers once all callers use the profile API.

### Milestone 6: Client Rendering And UI

- Update game store and network handlers for Battle Royal snapshots, safe-zone state, generic teams, and winner state.
- Update HUD, scoreboard, match summary, lobby, loading screen, map vote, minimap, voice HUD, and player markers for 10 teams.
- Add safe-zone minimap overlay and world-space boundary warning.
- Tune Battle Royal terrain warmup, culling, world dressing, and quality fallback.
- Ensure map vote previews do not render multiple full Battle Royal maps synchronously.

### Milestone 7: Capacity, Observability, And Load Testing

- Add Battle Royal capacity weighting to matchmaking admission, autoscaling, and admin capacity displays.
- Add benchmark scenarios for 30 human-like players over a Battle Royal map.
- Track server tick p95/p99, event-loop delay, stream bytes, interest recompute cost, line-of-sight checks, map generation time, collider count, renderable chunk count, and heap pressure.
- Add a scripted soak test that runs a 30-player Battle Royal match until match end.
- Tune replication, spatial queries, map budgets, and safe-zone cadence based on measured data.

## Test Plan

Use automated tests and harnesses rather than browser verification.

- Shared unit tests for `battle_royal` mode validation, labels, limits, team catalog, and config.
- Lobby tests for 30-player cap, 3-player team cap, 10-team cap, auto-assignment, ready flow, and Battle Royal restrictions.
- Game room tests for elimination, no respawn, winner detection, safe-zone damage, disconnect/reconnect behavior, and match summary outcomes.
- Map generator tests for determinism, diagnostics, spawn separation, 10 spawn clusters, route connectivity, budget limits, and cache keys.
- Client unit tests for generic team grouping, minimap projection, safe-zone overlay data, HUD state, and match summary grouping.
- Performance harnesses for 30-player server ticks, transform/vitals stream bytes, interest filtering, map generation timing, and memory pressure.

## Rollout Plan

1. Land mode rules and generic team refactors behind existing CTF/TDM tests.
2. Land Battle Royal as custom-only and non-ranked.
3. Keep Battle Royal hidden from quick play until 30-player load tests pass.
4. Run internal seeded map review across multiple themes and Battle Royal maps.
5. Enable Battle Royal in custom games.
6. Add matchmaking only after capacity admission and autoscaling have mode-aware weighting.

## Acceptance Criteria

- Battle Royal can be selected for custom lobbies.
- Battle Royal lobbies allow no more than 30 combat players.
- Battle Royal teams allow no more than 3 players.
- No more than 10 Battle Royal teams are assignable.
- Battle Royal maps use a mode-specific large profile, not the current arena `large` scale.
- Existing CTF and TDM behavior remains unchanged.
- Red/blue-only helper code is removed or deliberately scoped to CTF-only behavior.
- A full Battle Royal match ends when one team remains alive.
- Eliminated players do not automatically respawn during active Battle Royal play.
- Safe-zone state is server authoritative and visible to clients.
- Map generation and room runtime metrics stay within agreed Battle Royal budgets.
- Ranked, wagered, and bot-fill Battle Royal entry points are blocked until separately designed.

## Open Decisions

- Should Battle Royal v1 require exactly 30 players to start, or allow a lower custom-lobby minimum?
- Should solos and duos be first-class queue types, or should v1 use flexible 1 to 3 player teams only?
- Should eliminated teammates be allowed to spectate only their team, all players, or a delayed/free camera?
- What target match length should safe-zone tuning aim for?
- Should Battle Royal powerups be existing pickups only, or should it introduce mode-specific pickups later?
