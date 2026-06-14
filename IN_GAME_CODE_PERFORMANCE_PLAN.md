# In-Game Code Performance Optimization Plan

Last reviewed: June 13, 2026

## Goal

Make the live match feel as smooth as possible on the weakest practical devices by removing code overhead, allocation churn, React/render-loop work, and server-side simulation/replication waste.

This plan is intentionally code-first. It does not reduce texture quality, shader/effect fidelity, particle counts, shadow quality, draw distance, resolution, or other visible quality settings. Those can be a later pass if code wins are exhausted.

## Scope Rules

- Preserve current in-game visuals and gameplay behavior.
- Prefer fewer frame callbacks, fewer React commits, fewer object allocations, and fewer scene graph nodes.
- Keep existing diagnostics and add targeted measurements before large rewrites.
- Remove legacy code once confirmed legacy. Do not leave compatibility shims behind without an active protocol or migration reason.
- Do not add browser-based verification to this plan. Browser feel checks are left to the user.

## Current Baseline

The existing `docs/game-optimization-log.md` shows meaningful work already landed:

- Server simulation is already separated from client movement cadence: server tick at 20 Hz, client movement send cadence at 60 Hz.
- Local movement has lightweight self-authority and correction-only React state updates.
- Input command batching and self-authority buffering have been improved.
- Server message accounting no longer serializes payloads just to count bytes.
- Player interest churn was removed from the main hitch attribution path.
- Latest recorded retained server frame metrics from Pass 008 were roughly p95 17.6 ms, p99 17.7 ms, max 17.8 ms.

That means the next best wins are probably not "one bad tick loop." They are cumulative per-frame overhead: many idle `useFrame` callbacks, repeated player scans, effect slot trees, render-state churn, and avoidable allocation paths that hurt slow CPUs and integrated GPUs.

## Priority Summary

| Priority | Area | Why It Matters |
| --- | --- | --- |
| P0 | Measurement guardrails | Prevents regressions and proves whether each pass helps. |
| P1 | Consolidate frame loops | Removes fixed per-frame CPU tax from idle effects and remote players. |
| P1 | Remote player render pipeline | Current code still runs per-remote-player React components alongside batching. |
| P1 | Effect manager pooling and instancing | Many effect types mount hidden mesh trees or per-effect frame callbacks. |
| P1 | Store subscription and React churn | Reduces commits and selector fanout during active gameplay. |
| P2 | Terrain culling and geometry cache churn | Avoids React mount/unmount work and cache growth under map changes. |
| P2 | Hookshot/rope rendering consolidation | Rope/projectile effects do a lot of per-instance geometry work. |
| P2 | Server replication allocation paths | Reduces payload-building cost as player count grows. |
| P2 | Bot AI allocation and pathing | Helps bot-heavy or low-CPU environments. |
| P3 | Bundle and legacy cleanup | Improves load/runtime memory and keeps hot code understandable. |

## P0 - Measurement Guardrails

### Add Code-Level Budgets

Before changing the big systems, add or tighten measurements that do not rely on browser testing:

- Extend existing `measureFrameWork` labels so major systems can be separated:
  - `frame.remotePlayers`
  - `frame.remoteHeroBatch`
  - `frame.effects.global`
  - `frame.effects.phantom`
  - `frame.effects.blaze`
  - `frame.effects.chronos`
  - `frame.effects.hookshot`
  - `frame.terrainCulling`
  - `frame.dynamicLights`
- Add counters for:
  - active `useFrame` registrations by system
  - active effect slots by type
  - hidden-but-mounted effect slot counts
  - per-frame allocations where easy to count
  - React state commits from hot gameplay stores

### Add Non-Browser Perf Tests

Useful command targets to keep or add:

- `pnpm --filter @voxel-strike/client typecheck`
- `pnpm --filter @voxel-strike/client test:visual-store`
- `pnpm --filter @voxel-strike/server bench:room-load`
- `pnpm --filter @voxel-strike/server test:visibility-interest`
- focused Node/Vitest microbenchmarks for pure helpers introduced by this plan

Recommended new benchmarks:

- Remote player grouping with 8, 16, 24, 48 players.
- Effect slot scheduler with 0, 10, 50, 100 active effects.
- Voxel region culling with camera movement through dense maps.
- Server replication payload building with 12, 24, 48 players.
- Bot blackboard and route planning with 8, 16, 24 bots.

### Acceptance Criteria

- Each optimization pass records before/after numbers in `docs/game-optimization-log.md`.
- No pass reduces visual quality settings.
- No pass relies on subjective browser testing as the only verification.
- Existing gameplay diagnostics remain available.

## P1 - Consolidate Frame Loops

### Problem

The client has many independent `useFrame` callbacks. Some are always mounted, some poll store state, and some are per-effect or per-remote-player. Slow devices pay that overhead even when the visible work is small.

High-signal files:

- `apps/client/src/components/game/HeroViewmodel.tsx` has 15 `useFrame` occurrences.
- `apps/client/src/components/game/Effects.tsx` has 9 `useFrame` occurrences.
- `apps/client/src/components/game/WorldAtmosphere.tsx` has 4 `useFrame` occurrences.
- `apps/client/src/components/game/GameCanvas.tsx` has 4 `useFrame` occurrences.
- `apps/client/src/components/game/blaze/BlazeEffects.tsx`, `phantom/personalShield.tsx`, and `blaze/airstrike.tsx` each have several additional callbacks.

### Plan

1. Add a gameplay frame scheduler.
   - One R3F `useFrame` callback owns a list of active systems.
   - Systems register callbacks only while active.
   - Systems can declare cadence: every frame, every 2 frames, every 80 ms, every 100 ms.
   - Scheduler tracks cost per registered callback for diagnostics.

2. Replace idle per-slot `useFrame` calls.
   - `ObservedAbilityCastEffects.tsx` currently mounts 18 slot components, each with its own frame callback.
   - Move slot updates into one manager loop over active slot IDs.
   - Keep the same meshes/effects initially so the change is behavioral-neutral.

3. Replace repeated polling loops with active indexes.
   - Phantom, Blaze, Chronos Aegis, and Chronos Ascendant managers scan all players every 80 ms for status/effect flags.
   - Convert these to active ID indexes maintained by store/message updates.
   - Managers then read active IDs directly.

4. Track idle-loop elimination.
   - Add a debug counter for active scheduler callbacks.
   - Target: in a quiet 1-player scene, only core movement, camera, lighting, and terrain systems should tick.

### Expected Win

This reduces baseline CPU overhead and the amount of JavaScript executed every rendered frame. It is especially valuable on weak laptop CPUs and older mobile-class integrated GPUs where single-threaded frame budget is tight.

## P1 - Remote Player Render Pipeline

### Current Evidence

`apps/client/src/components/game/OtherPlayers.tsx` derives `otherPlayers`, renders `RemoteHeroBatchRenderer`, and also maps each player to an `OtherPlayer` component.

Observed structure:

- `OtherPlayers.tsx` lines 31-57 derive visible remote players from the full `players` map.
- `OtherPlayers.tsx` lines 60-68 render both `RemoteHeroBatchRenderer` and one `OtherPlayer` per remote player.
- `OtherPlayer` still owns per-player frame work for transform, opacity, pose, and ancillary visuals.

`apps/client/src/components/game/RemoteHeroBatchRenderer.tsx` is already doing important batching, but it still has avoidable per-frame and per-render work:

- `RemoteHeroBatchGroup` clears `Map` counters every frame.
- It loops all players, then loops all batch descriptors, then loops batches again for `needsUpdate`.
- The render path groups players and calls `Array.from(groupedPlayers, ...)`.

### Plan

1. Make `RemoteHeroBatchRenderer` the owner of remote body transforms.
   - Confirm which visuals still require `OtherPlayer`.
   - Move pose/opacity/death/hidden handling into the batch renderer or a sibling aggregate manager.
   - Remove duplicate per-player body work once confirmed redundant.

2. Split remote-player responsibilities cleanly.
   - Batched hero body meshes: one renderer.
   - Nameplates/UI markers: one aggregate manager or lightweight React layer.
   - Per-player one-off effects: event-driven effect managers.

3. Replace per-frame `Map` counting in batch groups.
   - Assign each hero/team batch a stable numeric index.
   - Use typed arrays or plain arrays for counts.
   - Reset only touched indices.

4. Avoid React grouping churn.
   - Keep stable group components for known hero/team combinations.
   - Feed each group an indexed list or active range.
   - Avoid creating new arrays in render unless player membership changed.

5. Add visibility and distance fast paths.
   - If a remote player is hidden, dead, or outside active interest, skip all body matrix writes.
   - Keep visible player IDs from the network interest layer rather than deriving everything from raw `players`.

### Expected Win

Remote players scale directly with match size. Removing per-player frame callbacks and reducing matrix-update overhead should improve worst-case team fights without changing visual quality.

## P1 - Global Effect Manager Pooling

### Current Evidence

`apps/client/src/components/game/Effects.tsx` maintains a capped global effects list, which is good, but the render path still maps active effects to individual React components. Many components own their own `useFrame`.

Examples:

- `GrappleLine`
- `BlinkEffect`
- `Explosion`
- `HitEffect`
- `LifelineEffect`
- `HealEffect`
- `ChronosSelfHealEffect`
- `AegisBreakEffect`

This creates many small objects, component lifecycles, material instances, and frame callbacks during combat bursts.

### Plan

1. Keep the current public effect API initially.
   - Preserve `addEffect` behavior.
   - Preserve caps and expiry semantics.
   - Internally route effect records to typed pools.

2. Create centralized pool managers by effect shape.
   - Line effects: grapple/lifeline style dynamic line geometry.
   - Sprite/billboard effects: hit/heal/impact style quads.
   - Burst effects: explosion/blink/aegis break style instanced meshes.

3. Use one frame loop per manager.
   - No per-effect `useFrame`.
   - Iterate active slots only.
   - Maintain free lists for slot allocation.

4. Share materials and geometries.
   - Materials should be created once per effect style.
   - Meshes should use instancing where visual shape is repeated.
   - Slot data should be plain arrays or typed arrays.

5. Remove the legacy component path once each effect type is migrated.
   - Do not keep both component and pooled implementations indefinitely.
   - Confirm parity through unit-level lifecycle tests and manual user feel checks later.

### Expected Win

Combat bursts should cause fewer React commits, fewer allocations, fewer material/mesh objects, and fewer independent frame callbacks.

## P1 - Hero-Specific Effect Managers

### Phantom Effects

Current evidence:

- `phantom/PhantomEffects.tsx` already uses pooled blink slots, which is a good pattern.
- It still mounts all slot mesh trees hidden.
- The manager scans active phantom effects and veil IDs every 80 ms.

Plan:

- Keep the pooled model.
- Convert status/effect discovery to active indexes fed by store/message updates.
- Lazily initialize heavy slot trees after first use or prewarm them during existing match warmup.
- Collapse hidden slot mesh trees into instanced layers where possible.

### Blaze Effects

Current evidence:

- `blaze/BlazeEffects.tsx` scans all players every 80 ms for remote flamethrower and burning state.
- `pushBurningPlayerId` uses array `includes` for dedupe.
- `BurningHeroFire` has per-active-player frame work.

Plan:

- Maintain active burning and flamethrower player ID sets in the visual/network store.
- Replace repeated scans with direct active ID reads.
- Replace per-player burning fire callbacks with one aggregate fire manager.
- Use `Set` or source-level dedupe for temporary ID collection.

### Chronos Effects

Current evidence:

- `chronos/aegis.tsx` and `chronos/ascendant.tsx` both poll all players every 80 ms.
- Each active player effect owns frame work.

Plan:

- Create a shared Chronos status-effect index.
- Drive Aegis and Ascendant renderers from that index.
- Consolidate per-player effect updates into one manager per effect family.

### Observed Ability Cast Effects

Current evidence:

- `ObservedAbilityCastEffects.tsx` has 18 slots.
- Each `ObservedAbilityCastEffectSlot` has its own frame callback even when empty.
- The manager also has a pruning frame callback.

Plan:

- Replace slot-local frame callbacks with one manager callback.
- Keep slot refs in arrays.
- Update only active slot IDs.
- Remove empty slot components once the manager can instantiate or reuse slots directly.

### Terrain Impact Effects

Current evidence:

- `TerrainImpactEffects.tsx` already centralizes per-frame updates.
- Impact triggering computes active pooled impacts by reducing over slots.
- Phantom and generic impact pools mount many hidden mesh/material trees.

Plan:

- Track active counts and free lists directly.
- Replace per-slot hidden mesh trees with instanced layers for repeated ring/spark/debris shapes.
- Share materials by impact style.
- Add pool pressure diagnostics for dropped impacts.

## P1 - Store Subscription and React Churn

### Current Evidence

Hot gameplay components subscribe to multiple store slices:

- `PlayerController.tsx` has many separate `useGameStore` subscriptions around its setup code.
- `OtherPlayers.tsx` subscribes to `players`, `playerId`, `localPlayerId`, and `gamePhase`.
- `GameCanvas.tsx` subscribes to game phase, practice/observer mode, map seed/theme, and quality settings.
- `visualStore.ts` is large and carries many mutable gameplay visual concerns.

The project already uses `useShallow` in some places. The next wins are about keeping hot render components from re-rendering when imperative frame code can read refs.

### Plan

1. Audit hot component subscriptions.
   - Identify subscriptions that only feed frame-loop code.
   - Move those reads to stable refs or store `getState()` in scheduler-managed loops.

2. Bundle selectors where React rendering actually depends on state.
   - Keep `useShallow` for render state.
   - Avoid many separate subscriptions in large gameplay components.

3. Split high-frequency visual state from React-visible state.
   - Position/pose/effect timing should not force React commits.
   - UI-visible summaries can update at lower cadence.

4. Add store mutation counters.
   - Count mutations per frame by slice during active gameplay.
   - Flag high-frequency mutations that cause object identity changes.

5. Preserve existing no-op reference behavior.
   - `projectileSlicePerformance.test.ts` already protects no-op projectile cleanup.
   - Add similar tests for visual effect cleanup and remote player derivation.

### Expected Win

Slow devices benefit when active gameplay is mostly imperative render updates instead of React reconciliation.

## P2 - Terrain, Voxel, and Map Runtime

### Current Evidence

`apps/client/src/components/game/VoxelMap.tsx` is already using CPU preparation, async region geometry, and progressive reveal.

Good existing patterns:

- `prepareVoxelMapCpu` is memoized.
- Region geometry prebuild respects a frame budget.
- Visible region reveal is progressive.
- Geometry cache clears on manifest unmount.

Remaining churn:

- Region culling runs around every 180 ms.
- It builds a new `Set`, creates a sorted signature string, updates React state, and filters regions.
- React then maps `renderedRegions` to region mesh components, so culling can cause mount/unmount churn.

### Plan

1. Keep region mesh components mounted after first reveal.
   - Toggle `mesh.visible` imperatively for culling.
   - Avoid React mount/unmount cycles as the camera moves.

2. Replace culling signature allocation.
   - Maintain stable visible flags by region index.
   - Track changed region IDs in scratch arrays.
   - Avoid `Array.from(nextIds).sort().join('|')` in the culling path.

3. Add cache budgets to `meshBuilder.ts`.
   - Current geometry cache is keyed by manifest/region and pending requests.
   - Add max cached geometry count or byte estimate.
   - Evict least recently used inactive region geometry when maps or variants change.

4. Strengthen worker fallback behavior.
   - The worker fallback can build geometry on the main thread.
   - Chunk fallback work over frames on slow devices rather than doing large synchronous geometry builds.

5. Tighten dressing cache lifecycle.
   - `WorldDressing.tsx` has a count-capped cache.
   - Add byte/instance-aware limits and clear entries for maps that are no longer active.

### Expected Win

Map traversal should produce fewer stutters from React churn, Set/sort/string allocations, and cache pressure.

## P2 - Hookshot and Rope Effects

### Current Evidence

Hookshot rendering is visually rich but code-heavy:

- `HookshotEffectsManager` maps active hooks to per-hook components.
- `hookProjectile.tsx` uses per-hook frame work for raycast visuals, enemy collision checks, and rope segment transforms.
- `grappleLine.tsx` does similar per-line frame work across multiple rope layers.

### Plan

1. Aggregate active hookshot updates.
   - One manager frame loop updates all active hook projectiles and grapple lines.
   - Per-hook data lives in arrays/slots.

2. Convert rope layers to instancing or dynamic line geometry.
   - Keep the same visual structure.
   - Avoid many individual mesh transforms per hook.

3. Reduce client-side collision scans.
   - Use server-authoritative hook target data where available.
   - Cache local candidate lists from the remote-player visibility layer.
   - Budget local visual raycasts to active local hooks first.

4. Remove old component path after parity.
   - Confirm the component implementation is no longer needed.
   - Delete it rather than leaving an unused fallback.

### Expected Win

Hookshot-heavy fights should spend less time updating rope transforms and scanning players.

## P2 - Dynamic Lights

### Current Evidence

`DynamicLightBudget.tsx` runs on a cadence and ranks registered lights by priority, intensity, and distance. This is much better than unmanaged lights, but it still scans the registered set.

### Plan

- Register lights only while they can contribute.
- Unregister or mark inactive lights with zero intensity instead of keeping every pooled light in the candidate set.
- Keep a compact active array for ranking.
- Add diagnostics for registered lights, active candidate lights, and lights enabled after budget.

### Expected Win

Effect-heavy scenes keep lighting cost proportional to visible active lights, not pool size.

## P2 - Server Replication and Simulation

### Current Evidence

`apps/server/src/rooms/GameRoom.ts` has one large room class with tick, bots, replication, vitals, interest, and match state.

Important hot paths:

- Tick/update path rebuilds spatial index, updates bots, switches phase, and broadcasts streams.
- `buildReplicationFrameContext` builds sets/maps and packed transforms/signatures.
- `broadcastPlayerTransforms`, `broadcastVitals`, and `broadcastInterest` each loop recipients and players.
- Existing interest churn was improved, but per-recipient payload building still scales with player count.

### Plan

1. Combine recipient/player scans where possible.
   - Build transforms, vitals, and interest deltas from one per-recipient scan when cadence aligns.
   - Keep separate network message types if protocol compatibility needs them.

2. Reuse scratch buffers.
   - Store scratch arrays/maps on the room instance.
   - Clear and reuse them per frame instead of allocating new collections.

3. Prepartition frame context.
   - Group players by team, alive/dead, visible/hidden, and interest eligibility.
   - Recipient scans can skip whole groups.

4. Avoid unchanged recipient payload work.
   - If recipient interest signature and transform signature are unchanged, skip deeper payload building.
   - Keep last signatures by recipient and stream type.

5. Split `GameRoom.ts` after behavior is measured.
   - Extract replication builders, bot scheduler, and match phase management into modules with tests.
   - This is not only style: smaller modules make microbenchmarks easier and reduce accidental coupling.

### Expected Win

Server CPU and allocation cost should grow more gently with higher player counts and bot-heavy rooms.

## P2 - Bot AI and Pathing

### Current Evidence

`apps/server/src/bots/bot-ai/index.ts` has several allocation-heavy blackboard helpers:

- Ally health debt calculation filters, maps, sorts, and computes enemy distances with temporary arrays.
- Heal cluster building filters/slices/reduces/maps.
- Blackboard construction filters players multiple times and sorts enemy arrays more than once.
- Route planning uses an open `Set` and scans it for the lowest cost on each expansion.

`GameRoom.ts` also creates bot snapshots and frame context maps/sets during bot updates.

### Plan

1. Replace repeated filter/map/sort chains in bot blackboard code.
   - Single-pass loops collect visible enemies, allies, weak targets, nearby counts, and objective distances.
   - Sort only when order is actually needed.

2. Cache route plans.
   - Reuse path results while target cell, map revision, and bot state are unchanged.
   - Invalidate on obstacle/revision changes.

3. Use a small priority queue for route planning.
   - Replace open-set scanning with a binary heap or bucket queue.
   - Keep allocations pooled for nodes where practical.

4. Reuse bot frame context collections.
   - Avoid rebuilding maps/sets from scratch where clear-and-reuse is safe.

5. Expand bot benchmarks.
   - Current server benchmarks are useful but should include 16, 24, and 48 entity bot-heavy cases.

### Expected Win

Bot CPU cost should become more predictable and less allocation-heavy, which matters on hosted low-tier CPUs and local practice modes.

## P3 - Bundle, Loading, and Runtime Memory

### Plan

- Audit in-game imports for lobby/admin/menu code accidentally pulled into gameplay chunks.
- Keep hero effect modules lazy where startup allows.
- Remove unreachable exports and compatibility aliases after confirming no imports remain.
- Prefer direct imports over barrel files in hot gameplay modules if barrels pull large side-effect trees.
- Keep asset quality unchanged.

### Expected Win

Lower startup memory and less JavaScript parsing gives slow devices more headroom before the match begins.

## P3 - Legacy Cleanup Candidates

These need confirmation before removal because some may preserve network or save compatibility:

- `packages/physics/src/movement/AerialMovement.ts` says a legacy movement shape is kept for network compatibility.
- `apps/client/src/store/types.ts` has legacy `wallSegments` visual segment data.
- `apps/client/src/store/settingsStore.ts` has legacy quality mapping.
- `apps/client/src/hooks/player/abilities/useBlazeAbilities.ts` has legacy targeting refs/hook notes.
- `apps/client/src/components/game/blaze/airstrike.tsx` has legacy export names.

Cleanup approach:

1. Confirm whether each item is still referenced by current protocol, persisted data, tests, or UI.
2. If not active, delete it in the same pass that removes its references.
3. If active only for compatibility, document the compatibility boundary and add a removal trigger.
4. Do not keep duplicate old/new implementations once migration is complete.

## Implementation Order

### Slice 1 - Instrumentation and Budgets

Files likely touched:

- `apps/client/src/components/game/performanceUtils.ts`
- `apps/client/src/components/game/GameplayFrameSystems.tsx`
- `apps/client/src/components/game/GameCanvas.tsx`
- `apps/server/src/scripts/performance-room-benchmark.ts`
- `docs/game-optimization-log.md`

Deliverables:

- More granular frame labels.
- Active frame callback/effect slot diagnostics.
- Non-browser benchmark cases for remote players, effects, server replication, and bots.

### Slice 2 - Scheduler and Idle Frame Loop Removal

Files likely touched:

- `apps/client/src/components/game/GameplayFrameSystems.tsx`
- `apps/client/src/components/game/ObservedAbilityCastEffects.tsx`
- `apps/client/src/components/game/phantom/PhantomEffects.tsx`
- `apps/client/src/components/game/blaze/BlazeEffects.tsx`
- `apps/client/src/components/game/chronos/aegis.tsx`
- `apps/client/src/components/game/chronos/ascendant.tsx`

Deliverables:

- Shared frame scheduler.
- Removed empty slot frame callbacks.
- Active status indexes replacing repeated player scans.

### Slice 3 - Remote Player Pipeline

Files likely touched:

- `apps/client/src/components/game/OtherPlayers.tsx`
- `apps/client/src/components/game/RemoteHeroBatchRenderer.tsx`
- `apps/client/src/store/visualStore.ts`
- `apps/client/src/contexts/NetworkContext.tsx`
- `apps/client/src/contexts/gameMessageHandlers.ts`

Deliverables:

- Single owner for remote body transforms.
- Removed duplicate per-player render path once confirmed redundant.
- Lower allocation batch grouping.
- Visibility/interest driven active player IDs.

### Slice 4 - Global and Hero Effect Pools

Files likely touched:

- `apps/client/src/components/game/Effects.tsx`
- `apps/client/src/components/game/TerrainImpactEffects.tsx`
- `apps/client/src/components/game/HookshotEffects.tsx`
- `apps/client/src/components/game/hookshot/hookProjectile.tsx`
- `apps/client/src/components/game/hookshot/grappleLine.tsx`
- hero-specific effect modules under `apps/client/src/components/game/*`

Deliverables:

- Pooled global effects by shape.
- Instanced repeated effect layers.
- One frame loop per effect manager.
- Deleted migrated legacy component paths.

### Slice 5 - Terrain Runtime Churn

Files likely touched:

- `apps/client/src/components/game/VoxelMap.tsx`
- `apps/client/src/game/voxel/meshBuilder.ts`
- `apps/client/src/components/game/WorldDressing.tsx`

Deliverables:

- Imperative region visibility toggles.
- Reduced culling allocations.
- Geometry and dressing cache budgets.
- Chunked main-thread fallback geometry builds.

### Slice 6 - Server and Bot Allocation Pass

Files likely touched:

- `apps/server/src/rooms/GameRoom.ts`
- `apps/server/src/bots/bot-ai/index.ts`
- `apps/server/src/scripts/performance-room-benchmark.ts`

Deliverables:

- Reused replication scratch buffers.
- Fewer per-recipient nested payload loops.
- Single-pass bot blackboard helpers.
- Cached route planning.
- Expanded room-load benchmarks.

### Slice 7 - Legacy Removal and Small Refactors

Files likely touched:

- Confirmed legacy files from the candidates section.
- Hot modules already touched by previous slices.

Deliverables:

- Removed confirmed-dead aliases, old paths, and redundant compatibility code.
- Scoped helper extraction where it reduces hot-path complexity.
- No unrelated rewrites.

## Risk Register

| Risk | Mitigation |
| --- | --- |
| Effect pooling changes visual timing | Keep public effect API stable, add lifecycle tests, migrate one effect family at a time. |
| Remote player consolidation breaks nameplates or status indicators | Split body rendering from UI markers before deleting `OtherPlayer` responsibilities. |
| Scheduler makes update order implicit | Give systems explicit priority/order and document it beside registration. |
| Store indexes get out of sync | Update indexes in the same store actions/message handlers that mutate source state, with tests. |
| Server scratch reuse leaks data between recipients | Clear buffers aggressively, add tests for recipient-specific payload isolation. |
| Terrain visibility toggles leave stale meshes visible | Add unit tests for culling helper outputs and diagnostics for active visible region count. |

## Verification Checklist

For each implementation slice:

- Run typecheck for touched packages.
- Run targeted unit/perf tests for the changed system.
- Run `git diff --check`.
- Update `docs/game-optimization-log.md` with before/after results.
- Confirm no texture/effect quality setting was reduced.
- Confirm no legacy path was left behind after replacement unless compatibility is documented.

Suggested non-browser commands:

```bash
pnpm --filter @voxel-strike/client typecheck
pnpm --filter @voxel-strike/client test:visual-store
pnpm --filter @voxel-strike/server bench:room-load
pnpm --filter @voxel-strike/server test:visibility-interest
git diff --check
```

## Definition of Done

The performance pass is done when:

- Quiet gameplay has minimal active frame callbacks.
- Combat bursts use pooled managers instead of per-effect React components where practical.
- Remote players have one authoritative render pipeline.
- Terrain movement avoids React culling churn.
- Server replication and bot AI benchmarks show no regressions and improved worst-case allocation/cpu behavior.
- Confirmed legacy code touched by the pass is removed.
- Visual quality and effect fidelity remain unchanged.
