# BR Combat Cluster Performance Plan

## Scope

This plan targets Battle Royale slowdowns when one player is near a dense fight, especially with bot fill. It is separate from `BR_MODE_MAP_OPTIMIZATION_PLAN.md`, which focuses on large-terrain rendering.

The reported symptom is mixed: client FPS drops, delayed actions, and continued movement after key release. Current evidence points first at client main-thread/render pressure, with server bot perception and replication still needing guardrails as player counts rise.

## Evidence

Benchmarks run locally, without browser testing:

| Area | Benchmark | Result |
| --- | --- | --- |
| Server existing BR | `game_room_tick_br_30_players` | p99 13.01ms, max 25.82ms. Top spike: `player_state_stream_fanout`. |
| Server existing bots | `game_room_tick_8_players_8_bots` | p99 6.05ms, max 6.44ms. Top span: `bot_updates`. |
| Server new clustered BR | `game_room_tick_br_cluster_1_player_8_bots` | p99 1.90ms, max 4.83ms. No budget breach. |
| Server new clustered BR | `game_room_tick_br_cluster_8_players_8_bots` | p99 2.98ms, max 3.66ms. No budget breach. |
| Server new clustered BR | `game_room_tick_br_cluster_4_players_24_bots` | p99 2.16ms, max 2.52ms. No budget breach. |
| Client existing BR combat | `br_canvas_combat_visual_cache_dense_skirmish` | p99 0.11ms, max 0.19ms. No budget breach. |
| Client existing transforms | `br_canvas_remote_transform_sampling_96_players` | p99 0.042ms, max 0.052ms. No budget breach. |
| Client remote hero batch, before fix | `br_canvas_remote_hero_batch_cpu_8_bot_cluster_full_roster` | Same 9 visible fighters with the real 33-player BR roster mounted 657 instanced meshes, including 480 empty mounted meshes. |
| Client remote hero batch, after fix | `br_canvas_remote_hero_batch_cpu_8_bot_cluster_full_roster` | p99 0.24ms, max 0.51ms. Full-roster input now mounts 9 groups, 177 instanced meshes, and 0 empty mounted meshes. |
| Client remote hero batch control | `br_canvas_remote_hero_batch_cpu_8_bot_cluster_visible_resources` | p99 0.17ms, max 0.51ms with the same 9 visible fighters. Visible-only resources also mount 9 groups, 177 instanced meshes, and 0 empty mounted meshes. |
| Client remote hero batch stress, after fix | `br_canvas_remote_hero_batch_cpu_dense_skirmish` | p99 0.33ms, max 0.71ms for 24 visible fighters and the real 33-player BR roster. Full-roster input now mounts 24 groups, 480 instanced meshes, and 0 empty mounted meshes. |
| Client existing effects/store | full `bench:br-combat-canvas` | Ability burst p99 0.58ms, effect trigger p99 0.71ms. No budget breach. |

The new server cases are now part of `apps/server/src/scripts/performance-room-benchmark.ts` and can be run with:

```bash
ROOM_BENCH_FILTER='game_room_tick_br_cluster' pnpm --filter @voxel-strike/server bench:room-load
```

The new client remote-hero case is now part of `apps/client/src/scripts/br-combat-canvas-benchmark.ts` and can be run with:

```bash
BR_CANVAS_BENCH_FILTER='remote_hero_batch' pnpm --filter @voxel-strike/client bench:br-combat-canvas
```

## Findings

1. The current server tick path does not reproduce a budget failure for the reported 1 player + about 8 bots BR cluster.
2. Clustered combat does exhaust bot line-of-sight and steering probe budgets in some samples, so bot decision quality can degrade in exactly these fights even when tick time is healthy.
3. The largest server risk at higher real-human counts is still per-recipient replication fanout, not the 1-player bot-fill case.
4. The previous client benchmark suite covered visual-store projectile queries, transform sampling, store bursts, and effect trigger setup, but missed remote body batching. The new headless benchmark covers remote transform/pose/matrix CPU, while actual browser/GPU render cost remains a user-side validation item.
5. The likely frame-drop source was `RemoteHeroBatchRenderer` mounted resource cardinality, not pose CPU. `OtherPlayers` filters hidden players out of the per-frame update list, but BR passes nearly the whole alive roster as `resourcePlayers`; before the fix, `buildRemoteHeroRenderGroups` created one mounted group per hero/team key, even when the group had no visible players.
6. Team-specific resource keys multiply mostly identical geometry/material batches across BR teams. At default balanced graphics, outlines are enabled, so this cost is paid in the reported clustered-fight case even though only about 9 fighters are visible.

## Optimization Plan

### Phase 0: Make The Repro Measurable

- Extend client diagnostics for BR combat clusters:
  - visible remote full bodies, silhouette bodies, fallback bodies, nameplates
  - active remote movement particles, ability effects, dynamic lights
  - remote hero batch count, instance count, material/geometry group count
  - frame hitch attribution for `RemoteHeroBatchRenderer`, `RemoteMovementEffects`, projectile/effect systems, terrain culling, and dynamic lights
- Add a dev-only snapshot action/log that the user can capture during the slowdown with `VITE_CLIENT_DIAGNOSTICS=1`.
- Keep the new server clustered BR benchmarks as regression guardrails.
- Keep the new remote hero batch benchmark as a CPU and batch-cardinality guardrail.

### Phase 1: Reduce Client Combat Render Pressure

- First fix, implemented: stop mounting empty full-roster remote hero groups in BR:
  - `resourcePlayers` still informs capacity for visible groups, but only visible `players` produce mounted render groups
  - `RemoteHeroBatchGroup` is no longer created for groups with no visible players
  - the 8-bot cluster full-roster benchmark now stays near the visible-only control: 9 groups, 177 mounted instanced meshes, and 0 empty mounted meshes
  - follow-up: optionally add a small recently-visible warm cache if user-side browser validation shows hitches when enemies first appear
- Second fix: collapse hero/team batch cardinality:
  - avoid duplicating full hero body resources by team when only outline color or bot marker color differs
  - move team color variance to instanced color attributes, a palette texture, or tiny team-only accent batches
  - change the main body resource key from hero/team to hero where possible
  - skip mounting outline instanced meshes entirely when the active quality profile has `outlineDistance <= 0`
- Add BR combat adaptive caps:
  - lower full remote body distance first for enemy bots
  - use silhouette/outline representation sooner for bots outside immediate threat range
  - suppress remote nameplates and movement particles during frame pressure
  - reduce dynamic light budget for remote abilities before reducing local feedback
- Make remote effects budget-aware:
  - cap concurrent observed cast effects by distance and ownership
  - prefer pooled/instanced effects for repeated bot attacks
  - decay or skip low-value remote particles when frame p95 rises
- Extend the remote hero batch benchmark to fail on excessive batch cardinality, not just CPU time, after the target batch count is chosen.

### Test Plan

- Automated non-browser checks:
  - `pnpm --filter @voxel-strike/client typecheck`
  - `BR_CANVAS_BENCH_FILTER='remote_hero_batch' pnpm --filter @voxel-strike/client bench:br-combat-canvas`
  - `pnpm --filter @voxel-strike/client bench:br-combat-canvas`
  - `pnpm --filter @voxel-strike/server typecheck`
  - `ROOM_BENCH_FILTER='game_room_tick_br_cluster' pnpm --filter @voxel-strike/server bench:room-load`
- Add benchmark assertions after the first optimization lands:
  - 8-bot cluster full-roster `mountedInstancedMeshes <= 220`
  - 8-bot cluster full-roster `emptyMountedInstancedMeshes <= 0`
  - dense skirmish full-roster `mountedInstancedMeshes <= 520`
  - dense skirmish full-roster `emptyMountedInstancedMeshes <= 0`
  - remote hero batch CPU p99 remains below 8ms
- User-side browser validation:
  - enable `VITE_CLIENT_DIAGNOSTICS=1`
  - reproduce BR bot-fill fight with about 8 nearby bots
  - capture diagnostics before/after: frame hitches above 33ms, remote hero mounted meshes, empty mounted meshes, dynamic lights, remote movement particles, and input send cadence

### Phase 2: Tighten Server Cluster Behavior

- Change BR bot perception candidate collection to use `PlayerSpatialIndex` instead of scanning every alive enemy for every bot.
- Always include current target/recent-damage players in candidate sets so spatial culling does not make bots forget important fights.
- Revisit bot criticality rules so nearby bots actively fighting the local player get consistent movement/ability simulation, while background bots stay cheaper.
- Add per-recipient fanout guardrails for BR:
  - exact transforms only for high-relevance visible enemies
  - lower heartbeat cadence for far/background bots
  - cap interest/vitals changes per recipient when many enemies churn visibility at once

### Phase 3: Acceptance Targets

- Server clustered BR benchmarks stay below p99 10ms and max 25ms locally.
- Client diagnostics from the reported scenario show no repeated frame hitches above 33ms after adaptive caps engage.
- Local input send cadence stays steady during render pressure; key release should produce a movement command flush within the next client frame.
- Visual downgrade order preserves readability: local player feedback, nearby threats, and hit confirmation remain highest priority.
