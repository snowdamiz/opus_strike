# Slop Heroes Optimization Plan

Date: 2026-06-07

Scope: optimize the browser game end to end without changing gameplay feel. This plan focuses on client FPS/frame-time, server tick time, network bandwidth, memory churn, load time, and scalability for bot-filled 5v5 matches.

Constraint: do not test in the browser from the agent side. Browser profiling and visual verification are left to the user.

## Executive Summary

The biggest performance wins are not small micro-optimizations. The hot path is a stack of high-frequency systems all doing more work than they need to:

1. Network state is synchronized twice on the client: explicit `playerStates` messages and a 50ms schema polling loop. This causes duplicate object allocation, duplicate store writes, and extra React churn.
2. The server rebuilds and broadcasts full player snapshots every 20Hz tick, including low-frequency fields such as stats, abilities, flags, and names.
3. Projectile and ability effects still render many individual meshes, lights, particles, and per-effect `useFrame` loops. An `InstancedRockets` component exists, but `RocketsManager` still renders the old per-rocket `RocketEffect` path.
4. `GameCanvas` subscribes to high-frequency projectile arrays and passes them into child effects, increasing top-level render pressure.
5. Player avatars are visually rich but expensive: each remote player mounts a `HeroVoxelBody`, HTML nameplate, beacon, point light, and multiple `useFrame` callbacks.
6. The procedural voxel mesh builder has a greedy meshing helper but currently emits one quad per visible block face, leaving a large triangle-count win unused.
7. Bot AI does O(bots * players * line-of-sight-samples) work and calls voxel lookup loops during 20Hz ticks.
8. Client defaults are expensive for a competitive browser game: high DPR, 4096 shadow maps, high reflection resolution, high environment density, and many dynamic point lights.
9. Development logging is widespread in high-frequency paths. Production build drops console calls, but development profiling and local gameplay pay the cost.
10. The client bundle pulls in wallet/Solana dependencies at startup even though wallet auth is not needed for the first rendered game shell.

Target outcome:

- Stable 60 FPS on medium hardware during a full 5v5 match with ability spam.
- 95th percentile client frame time below 16.7ms on "competitive" settings, below 22ms on "high" settings.
- Server tick time below 8ms p95 for 10 players plus bots.
- Network state traffic reduced by at least 50 percent in active matches.
- Cold route startup avoids wallet/auth bundle and shader compilation hitches.

## Hotspot Inventory

| Priority | Area | Evidence | Why It Hurts | Primary Fix |
|---|---|---|---|---|
| P0 | Duplicate state sync | `apps/client/src/contexts/NetworkContext.tsx` sets MapSchema callbacks, starts `setupPollingSync`, and also installs `setupPlayerStatesHandler`; `apps/client/src/contexts/gameMessageHandlers.ts` polls every 50ms | Duplicate sync at 20Hz, repeated object spreading, repeated store writes | Pick one authoritative high-frequency stream, remove polling for active gameplay, keep schema callbacks for joins/leaves only |
| P0 | Full server snapshots | `apps/server/src/rooms/GameRoom.ts` `broadcastPlayerStates()` rebuilds all players every tick | Bandwidth and serialization scale with player count and payload size, not actual changes | Split high-frequency transform stream from low-frequency semantic events |
| P0 | Rocket instancing unfinished | `apps/client/src/components/game/effects/instanced/InstancedRockets.tsx` exists; `apps/client/src/components/game/blaze/rockets.tsx` still maps `RocketEffect` | 6 meshes per rocket plus per-rocket frame loop and collision loop | Integrate `InstancedRockets`, move collision to one projectile system |
| P0 | Top-level render subscriptions | `apps/client/src/components/game/GameCanvas.tsx` subscribes to `voidZones`, `direBalls`, `voidRays` and passes arrays down | Top-level Canvas subtree becomes sensitive to projectile list changes | Effects managers should own subscriptions or read from non-reactive effect registries |
| P0 | Projectile store churn | `apps/client/src/store/slices/projectiles.ts` adds with array spreads, updates with `map`, clears with repeated `filter` | Allocates arrays every cleanup/update; triggers React updates for visual-only lifetime changes | Convert high-volume visual effects to pooled registries or map-backed slices with batched cleanup |
| P1 | Remote player cost | `apps/client/src/components/game/OtherPlayers.tsx` uses `Html`, per-player point lights, multiple `useFrame`s, and rich voxel bodies | Cost scales per player and per bot; HTML overlays are especially expensive in R3F | Add player LOD, distance culling, shared nameplate layer, and optional light budgets |
| P1 | Many independent `useFrame` loops | Effect components across `blaze`, `phantom`, `hookshot`, `glacier`, `WorldAtmosphere`, `HeroVoxelBody`, `OtherPlayers` | Scheduler overhead, duplicated `Date.now()`, repeated store reads, uncoordinated updates | Introduce centralized frame systems for projectiles, particles, lights, and effect cleanup |
| P1 | Bot AI LOS | `GameRoom` bot blackboards scan all players; `hasLineOfSight` samples blocks along a ray; `isBotPathBlocked` samples player volume | Bots can dominate server ticks when many are active | Cache blackboards, throttle LOS, spatially index players, and cache terrain queries |
| P1 | Procedural voxel geometry | `meshBuilder.ts` defines `greedyMask` but `buildVoxelChunkGeometry` emits each visible face one at a time | Excess vertices, indices, upload time, and GPU raster work | Implement greedy meshing per axis and cache generated geometry by manifest/chunk/material detail |
| P1 | Physics terrain queries | Server `getProceduralGroundY` scans downward and calls `getBlockAtWorld`; client physics raycasts and temp wall colliders are cleaned with intervals | Movement and bot collision do many terrain checks per tick/frame | Precompute heightfield/top-surface maps and spatial collider bins |
| P1 | Dynamic light budget | `GameCanvas`, bombs, hookshot, glacier, airstrike, terrain impacts, name beacons, rockets create point lights | Forward-rendered dynamic lights multiply shader cost and shadow/material complexity | Cap lights, replace most with emissive materials/sprites, keep only nearest/important lights |
| P1 | Quality defaults | `settingsStore.ts` defaults to high DPR, high shadows, high reflection/environment quality | First run favors maximum visuals over stable frame time | Add "competitive" default or auto-calibration, lower default shadows/reflections/environment |
| P2 | Bundle weight | `WalletContext.tsx` imports `@solana/web3.js`, `bs58`; `main.tsx` polyfills `Buffer` on startup | Heavy auth dependencies hit initial bundle even before gameplay | Lazy-load wallet auth and Solana dependencies only when wallet flow is opened |
| P2 | Dev logging | `rg` found many console calls in network, rooms, physics, combat, player rendering | Dev profiling is polluted by logs and string formatting | Add env-gated logger with sampled high-frequency logs |
| P2 | Audio startup hitches | `useAudio.ts` fetches and decodes sounds on demand | First ability use can hitch or delay feedback | Hero-based audio preloading and decode scheduling |
| P2 | Build/code-split | Vite config has no manual chunks or analyzer; all gameplay/UI/auth likely shipped together | Larger startup and slower parse/compile | Split auth, lobby, game canvas, heavy heroes/effects, and Rapier/WASM paths |

## Phase 0: Measurement Harness

Goal: make every optimization prove itself.

### Tasks

1. Add a lightweight perf mark utility.
   - Files: `apps/client/src/components/game/PerfMonitor.tsx`, `apps/client/src/store/settingsStore.ts`, new `apps/client/src/utils/perfMarks.ts`.
   - Track frame p50/p95/p99, draw calls, triangle count, texture count, geometries, shader count, active effects, active lights, active `useFrame` systems, and projectile counts.
   - Keep the current `r3f-perf` path behind `debugMode` or `showFPS`.

2. Add server tick timing.
   - Files: `apps/server/src/rooms/GameRoom.ts`, new `apps/server/src/perf/tickMetrics.ts`.
   - Measure `updateBots`, `updatePlaying`, `updatePhysics`, `updateCTFObjectives`, `broadcastPlayerStates`, and per-message input handling.
   - Emit sampled summaries every 10 seconds in development and expose a lightweight room debug message only when requested.

3. Add network byte counters.
   - Files: `apps/server/src/rooms/GameRoom.ts`, `apps/client/src/contexts/gameMessageHandlers.ts`.
   - Approximate serialized payload size for `playerStates`, lobby lists, combat events, and ability events.
   - Track messages per second and bytes per second per room.

4. Create repeatable scenarios.
   - Full 5v5 with 0, 4, and 9 bots.
   - Projectile spam: Blaze rockets/bombs/flamethrower, Phantom dire balls/void rays/void zones, Hookshot chains/traps/walls, Glacier wall rush/frost storm.
   - Dense atmosphere/map scenario with high visual settings.

Success criteria:

- A single debug overlay or log line answers: "what is slow right now?"
- Every phase below has before/after numbers.
- Browser verification remains manual.

## Phase 1: Remove Duplicate Network Sync

Goal: stop doing the same high-frequency work twice.

### Current Hotspot

`NetworkContext.tsx` installs:

- MapSchema `onAdd` and per-schema `onChange`.
- `setupPollingSync(...)`, which polls every 50ms.
- `setupPlayerStatesHandler(...)`, which processes explicit server `playerStates` messages.

`GameRoom.ts` also broadcasts `playerStates` every 20Hz tick in active phases.

### Plan

1. Make `playerStates` the only high-frequency active-game transform stream.
   - Keep MapSchema callbacks for add/remove and low-frequency schema safety.
   - Disable `setupPollingSync` once a room has explicit `playerStates`.
   - Keep an emergency dev-only fallback poll behind a setting or feature flag.

2. Stop high-frequency `actions.updatePlayer` from replacing whole player objects for remote players.
   - Use `useGameStore.updateGameState` style in-place mutation for transform-only fields.
   - Write transforms to `visualStore`.
   - Only change the `players` Map reference when players are added/removed or when semantic fields change.

3. Split local player reconciliation.
   - Local predicted position should stay client-owned except for teleports, respawns, death, server correction, or large divergence.
   - Move correction thresholds into constants and log sampled corrections.

4. Consolidate ghost cleanup.
   - Remove the 50ms poll dependency.
   - Trigger cleanup on join/leave/duplicate-session and on a slower dev-only timer.

Files:

- `apps/client/src/contexts/NetworkContext.tsx`
- `apps/client/src/contexts/gameMessageHandlers.ts`
- `apps/client/src/store/gameStore.ts`
- `apps/client/src/store/visualStore.ts`

Expected impact:

- 30 to 50 percent less client sync work during matches.
- Lower React update count during active gameplay.
- Lower GC churn from repeated `Player` object reconstruction.

Validation:

- With 10 players, one high-frequency handler should process exactly 20 messages/sec, not 20 messages plus 20 polls/sec.
- Remote player position interpolation should still be smooth.
- Join/leave, respawn, hero select, flag carry, damage, and kill feed still update.

## Phase 2: Split Server State Streams

Goal: send small packets often and rich packets rarely.

### Current Hotspot

`broadcastPlayerStates()` builds a full array for all players every tick, including:

- Identity: id, name, team, heroId, bot info.
- Transform: position, velocity, lookYaw, lookPitch.
- Gameplay: health, ultimateCharge, hasFlag, movement flags.
- Abilities: full ability map.
- Stats: kills, deaths, assists, captures, returns.
- Match state: scores, flags, round time.

Most of that does not need to update at 20Hz.

### Plan

1. Create three server messages:
   - `playerTransforms`: 20Hz, only id, position, velocity, yaw, pitch, compact movement bits, tick/serverTime.
   - `playerVitals`: 5 to 10Hz or on change, health, ultimate, state, hasFlag, ability cooldowns/charges.
   - `matchSnapshot`: 1 to 2Hz or on change, scores, flags, roundTimeRemaining, phase, stats.

2. Add dirty flags per player.
   - Mark dirty on hero/team/state/health/ability/stat/flag changes.
   - Broadcast semantic diffs only when dirty.

3. Quantize transforms.
   - Position: fixed-point centimeters or decimeters.
   - Yaw/pitch: int16 angle.
   - Movement state: bitset instead of nested object.
   - Keep JSON initially if fastest to implement, then evaluate binary/MessagePack only if JSON remains a bottleneck.

4. Stop broadcasting transforms for selecting/dead players unless needed.
   - Hero select/lobby can use 5Hz or event-driven updates.
   - Dead players need state/timer, not 20Hz transform.

5. Use Colyseus patching deliberately.
   - Either lean into schema patching for semantic state and explicit message stream for transforms, or use explicit messages for both.
   - Avoid running schema patch sync plus parallel full snapshots for the same fields.

Files:

- `apps/server/src/rooms/GameRoom.ts`
- `packages/shared/src/types/network.ts`
- `apps/client/src/contexts/gameMessageHandlers.ts`
- `apps/client/src/store/gameStore.ts`

Expected impact:

- 50 to 80 percent less transform bandwidth.
- Lower server serialization cost.
- Lower client parsing and object allocation cost.

Validation:

- Compare bytes/sec before and after in 1v1, 5v5, and 5v5 plus bots.
- Verify score, flag, health, cooldown, respawn, and death UI still updates promptly.

## Phase 3: Finish Projectile Instancing and Centralize Projectile Simulation

Goal: move projectile visuals from "many React components with many frame loops" to "few instanced renderers with one simulation pass per family."

### Current Hotspots

- `InstancedRockets.tsx` exists but is not used by `RocketsManager`.
- `RocketsManager` still filters and maps `RocketEffect` components.
- `DireBalls`, `VoidRays`, `VoidZones`, `HookshotEffectsManager`, and `GlacierEffectsManager` map active arrays to individual components.
- Many projectile components run collision checks against all players in their own `useFrame`.
- Store cleanup uses intervals plus repeated `filter` calls.

### Plan

1. Finish rockets first.
   - Integrate `InstancedRockets` into `RocketsManager`.
   - Remove the old per-rocket render path from the active tree.
   - Move rocket terrain/player collision into a central `useProjectileSimulation` frame system.
   - Keep one shared rocket light or replace it with emissive material.

2. Add instanced renderers by effect family.
   - `InstancedDireBalls`: core, glow, trail points or billboards.
   - `InstancedVoidRays`: beam segments, endpoint spheres, particles.
   - `InstancedBombs`: falling bomb body, warning rings, explosion debris.
   - `InstancedHookProjectiles`: hook head, rope segments, drag hook, grapple line.
   - `InstancedImpactParticles`: terrain impact particles/smoke/debris.

3. Pool effect records.
   - Replace array append/filter loops for visual-only effects with fixed-capacity pools.
   - Store active count, id, start time, owner, transform, type, and payload.
   - Make cleanup O(active) in the central frame system and avoid React state churn.

4. Separate authoritative gameplay from local visuals.
   - Server remains authoritative for damage and kills.
   - Client collision checks should only trigger local impact visuals and prediction hints.
   - Avoid removing server-owned projectiles purely from local collision if the server may still report them.

5. Kill per-spawn shader hitches.
   - Prewarm all projectile materials when a match begins and when a hero is selected.
   - Do not clone shader materials per projectile unless uniforms differ.
   - For differing uniforms, use instanced attributes or a small material pool.

Files:

- `apps/client/src/components/game/effects/instanced/InstancedRockets.tsx`
- `apps/client/src/components/game/blaze/rockets.tsx`
- `apps/client/src/components/game/phantom/direBall.tsx`
- `apps/client/src/components/game/phantom/voidRay.tsx`
- `apps/client/src/components/game/phantom/voidZone.tsx`
- `apps/client/src/components/game/blaze/bomb.tsx`
- `apps/client/src/components/game/hookshot/*`
- `apps/client/src/components/game/TerrainImpactEffects.tsx`
- `apps/client/src/store/slices/projectiles.ts`

Expected impact:

- Rocket spam draw calls should drop from roughly 6 meshes * rockets to roughly 6 draws total.
- Ability spam should stop multiplying React components and frame callbacks.
- Reduced GC spikes during fights.

Validation:

- Before/after draw calls during 30 rockets, 20 dire balls, multiple hooks, and airstrike.
- No missing impact visuals.
- Projectiles despawn exactly once.

## Phase 4: Decouple GameCanvas From High-Frequency Effect Arrays

Goal: make the top-level R3F scene stable while effect managers handle their own subscriptions.

### Current Hotspot

`GameCanvas.tsx` subscribes directly to:

- `gamePhase`
- `voidZones`
- `direBalls`
- `voidRays`
- `mapSeed`
- settings

It passes projectile arrays into `VoidZones`, `DireBalls`, and `VoidRays`, so projectile list changes can cause `GameCanvas` to re-render and recreate child props.

### Plan

1. Move projectile subscriptions into their managers.
   - `VoidZonesManager`, `DireBallsManager`, `VoidRaysManager` should read directly from optimized stores or registries.
   - `GameCanvas` should only know whether gameplay effects should be mounted.

2. Use selectors with stable equality.
   - Avoid `useGameStore()` without selectors in scene code.
   - Use `useShallow` where objects are unavoidable.
   - Prefer non-reactive stores for 60fps visual values.

3. Split static scene from dynamic scene.
   - `StaticWorldScene`: lights, world, atmosphere, grid, flags shell.
   - `DynamicGameplayScene`: players, projectiles, local controller.
   - Settings changes can remount what must remount, not everything.

4. Audit `key={`${settings.resolutionScale}:${settings.antialiasing}`}` on `Canvas`.
   - Remounting Canvas for settings changes is valid for DPR/AA, but expensive.
   - For non-AA settings, update renderer in place.

Files:

- `apps/client/src/components/game/GameCanvas.tsx`
- `apps/client/src/components/game/PhantomEffects.tsx`
- `apps/client/src/components/game/BlazeEffects.tsx`
- `apps/client/src/components/game/HookshotEffects.tsx`
- `apps/client/src/components/game/GlacierEffects.tsx`

Expected impact:

- Fewer top-level renders during projectile-heavy gameplay.
- Lower mount/unmount churn when effects spawn/despawn.

Validation:

- React Profiler should show `GameCanvas` stable during projectile spam.
- R3F object count changes should only reflect actual effects.

## Phase 5: Remote Player LOD and Nameplate Rewrite

Goal: make 10 players cheap enough that ability effects, not avatars, own the frame budget.

### Current Hotspots

`OtherPlayers.tsx` mounts for each remote player:

- `HeroVoxelBody`, which can render many small meshes per hero.
- `Nameplate` with Drei `Html` and raycast occlusion.
- `PlayerVisibilityBeacon` with torus and point light.
- Several `useFrame` callbacks per player.

### Plan

1. Add player LOD tiers.
   - Tier 0, near: full `HeroVoxelBody`, nameplate, animation, team accents.
   - Tier 1, mid: simplified body, no HTML occlusion, no per-player point light.
   - Tier 2, far: single instanced billboard/body marker, name only on aim/hover/scoreboard.
   - Tier 3, out of view/behind occluder: no body update, maybe minimap/team marker only later.

2. Replace HTML nameplates.
   - Use a single overlay system that projects world positions to screen once per frame.
   - Or use sprite/text atlas nameplates in Three, without per-name `Html` DOM nodes.
   - Disable raycast occlusion by default; sample occlusion at low rate if necessary.

3. Instanced or merged avatar parts.
   - Cache geometries and materials globally by hero/team/material kind.
   - Consider a simplified instanced body for remote players using body part instancing per hero/team.
   - Keep the local hero presentation rich.

4. Light budget for players.
   - Remove `PlayerVisibilityBeacon` point lights.
   - Use emissive materials/sprites/rings.
   - Only allow N nearest high-priority dynamic lights in the scene.

5. Consolidate per-player frame updates.
   - One `RemotePlayerSystem` reads visual positions/rotations and updates refs for all remote groups.
   - Child bodies expose refs rather than running their own independent frame loops when possible.

Files:

- `apps/client/src/components/game/OtherPlayers.tsx`
- `apps/client/src/components/game/HeroVoxelBody.tsx`
- `apps/client/src/components/ui/HeroIcons.tsx`
- `apps/client/src/store/settingsStore.ts`

Expected impact:

- Lower CPU frame time with many players/bots.
- Fewer DOM nodes and raycasts from `Html` nameplates.
- Fewer dynamic lights.

Validation:

- Compare 1v1 vs 5v5 frame time. The incremental cost per remote player should be predictable.
- Verify team readability, bot visibility, flag carrier visibility, and health readability.

## Phase 6: Centralize Frame Systems and Cleanup

Goal: reduce scheduling overhead, duplicate clock reads, and repeated store array operations.

### Current Hotspots

Repeated patterns:

- Many `setInterval` cleanup loops in effect managers.
- Many `filter` calls for expiry in render paths and stores.
- Many `Date.now()` calls inside frame loops.
- Multiple independent `useFrame` callbacks for related effect families.

### Plan

1. Introduce `FrameClock`.
   - One source for `nowMs`, `elapsed`, `delta`, clamped delta.
   - Expose to gameplay visual systems.

2. Introduce effect systems.
   - `ProjectileFrameSystem`
   - `ImpactFrameSystem`
   - `TemporaryColliderSystem`
   - `AtmosphereFrameSystem`
   - `DynamicLightSystem`

3. Batch cleanup.
   - One cleanup pass per frame or per 100ms bucket.
   - Remove "each manager has its own interval" pattern.
   - Do not call Zustand `set` if the active list did not actually change.

4. Replace array-heavy state actions.
   - For frequently updated effects, use a stable pool outside React state.
   - For low-frequency UI state, keep Zustand arrays.
   - For IDs, keep `Map<string, index>` or `Set<string>` to avoid repeated `.some()`.

Files:

- `apps/client/src/store/slices/projectiles.ts`
- `apps/client/src/store/slices/glacier.ts`
- `apps/client/src/components/game/*Effects*.tsx`
- `apps/client/src/hooks/physics/iceWallColliders.ts`
- `apps/client/src/hooks/usePhysics.ts`

Expected impact:

- Less GC pressure.
- Fewer React updates.
- More predictable frame time during effect bursts.

Validation:

- Heap allocation timeline during 60 seconds of ability spam should flatten.
- Expired effects should disappear within their expected lifetime.

## Phase 7: Procedural Voxel Geometry and Collider Optimization

Goal: reduce map startup cost, geometry size, collider count, and terrain-query cost.

### Current Hotspots

- `meshBuilder.ts` includes a `greedyMask` helper, but `buildVoxelChunkGeometry` emits per visible face.
- `createBlockAccessor` builds a chunk lookup per chunk geometry build.
- Client loads all colliders from the manifest into Rapier.
- Server terrain queries scan down from current Y and do chunk string lookups.

### Plan

1. Implement real greedy meshing.
   - Sweep X, Y, and Z axes.
   - Build masks for positive/negative faces.
   - Merge same block/material faces into rectangles.
   - Preserve UV atlas correctness by scaling UVs across merged faces or using repeat-friendly atlas rules.

2. Cache chunk lookup and geometry.
   - Build block accessor once per manifest.
   - Cache `BufferGeometry` by `manifest.id + chunk.coord + materialDetail`.
   - Dispose cache on map seed change.

3. Precompute terrain heightfield.
   - In `generateProceduralVoxelMap`, produce top solid Y for each X/Z.
   - Server `getProceduralGroundY` becomes O(1) for normal movement.
   - Bot pathing uses heightfield first and block lookup only for special cases.

4. Optimize colliders.
   - Ensure generated colliders are merged aggressively.
   - Split colliders into spatial chunks and only load/activate nearby if collider count is high.
   - For static maps, precompute collider manifest and geometry instead of regenerating client-side.

5. Move heavy generation off main thread where useful.
   - Optional worker for `generateProceduralVoxelMap` and `buildVoxelChunkGeometry`.
   - Show loading progress without blocking first interaction.

Files:

- `apps/client/src/components/game/procedural/meshBuilder.ts`
- `apps/client/src/components/game/procedural/VoxelMap.tsx`
- `apps/client/src/components/game/procedural/VoxelChunkMesh.tsx`
- `packages/shared/src/maps/procedural/generator.ts`
- `packages/shared/src/maps/procedural/colliders.ts`
- `apps/server/src/rooms/GameRoom.ts`
- `apps/client/src/hooks/usePhysics.ts`

Expected impact:

- Large triangle and vertex reduction on terrain.
- Faster map load and lower GPU cost.
- Faster bot and movement terrain queries.

Validation:

- Compare chunk vertex/index counts before and after.
- Verify no visible holes, UV smearing, or collision mismatch.
- Compare map generation time and collider load time.

## Phase 8: Server Tick and Bot AI Optimization

Goal: keep server tick p95 below 8ms with 10 active participants.

### Current Hotspots

Bot logic:

- Builds blackboards by scanning all players.
- Calls `hasClearShot` for perception and target scoring.
- `hasLineOfSight` samples blocks every `BOT_LOS_SAMPLE_STEP`.
- Path blocking samples player volume along movement path.

Gameplay tick:

- Updates all players every tick.
- Runs void zones against every player.
- Runs flamethrower checks.
- Broadcasts full state.

### Plan

1. Spatial index players each tick.
   - Uniform grid or simple team buckets for player positions.
   - Queries: nearby enemies/allies, void zone candidates, flamethrower candidates.
   - Avoid scanning all players for every bot/effect.

2. Throttle bot thinking.
   - Keep 20Hz input application, but blackboard/intent updates at bot skill think interval.
   - Aim smoothing can update every tick.
   - LOS checks cached for 100 to 250ms per bot-target pair.

3. Cache terrain LOS.
   - Hash start/end grid cells and reuse for a short window.
   - Early-out with distance and bounding boxes.
   - Use heightfield for obvious open/blocked checks before sampling.

4. Optimize area effects.
   - Void zones and flamethrowers query spatial index first.
   - Keep squared distances where exact distance is not required.
   - Avoid allocating temp objects in hot loops.

5. Split dev NPC tooling out of production room path.
   - Keep dev handlers behind development mode.
   - Move NPC management into a separate module to reduce `GameRoom` complexity.

6. Add tick budget enforcement.
   - If bot AI exceeds budget, skip lower priority bot think updates until next tick.
   - Never skip critical physics, damage, or objective updates.

Files:

- `apps/server/src/rooms/GameRoom.ts`
- `apps/server/src/rooms/abilityHandlers.ts`
- `packages/physics/src/movement/sharedSimulator.ts`
- `packages/shared/src/maps/procedural/*`

Expected impact:

- Bot-filled matches scale much better.
- Server tick spikes from LOS/pathing drop.
- Lower input latency under load.

Validation:

- Compare `updateBots`, `updatePhysics`, and total tick p95 with 0, 4, and 9 bots.
- Verify bots still pursue objectives, attack, and recover from obstacles.

## Phase 9: Client Physics and Collision Query Optimization

Goal: make local movement/collision predictable and cheaper.

### Current Hotspots

- Client movement uses many raycasts and helper checks through `usePhysics.ts`.
- Projectile components each raycast and scan players independently.
- Temporary wall colliders are cleaned by intervals.
- Server shared movement already has a terrain adapter, but client physics and server terrain logic are not fully unified.

### Plan

1. Separate movement query API from raw Rapier calls.
   - `PhysicsQueryService`: ground, body clearance, teleport validation, projectile sweep, wall check.
   - Internally cache repeated queries per frame.

2. Use precomputed map data first.
   - Ground and simple collision can use heightfield/block data before Rapier.
   - Rapier remains for dynamic/temporary colliders and precise checks.

3. Batch projectile sweeps.
   - One system sweeps all active projectiles.
   - One player list scan per projectile family or spatial index query.

4. Pool temporary colliders.
   - Ice/earth walls should reuse collider records and schedule expiry centrally.
   - Avoid repeated full cleanup scans.

5. Align client/server movement.
   - Use shared simulation where possible.
   - Keep client prediction and server validation semantics explicit.

Files:

- `apps/client/src/hooks/usePhysics.ts`
- `apps/client/src/hooks/player/usePlayerPhysics.ts`
- `apps/client/src/hooks/physics/iceWallColliders.ts`
- `packages/physics/src/movement/sharedSimulator.ts`
- `apps/server/src/rooms/GameRoom.ts`

Expected impact:

- Fewer raycasts per frame.
- Less projectile collision CPU.
- Fewer movement edge-case corrections.

Validation:

- Count raycasts per frame in normal movement, wall rush, hooks, and projectile spam.
- Verify stepping, crouch clearance, teleport targeting, wall rush, and hook impacts.

## Phase 10: Dynamic Light, Shadow, and Quality Budget

Goal: preserve the look while making expensive visuals opt-in, adaptive, and capped.

### Current Hotspots

- `GameCanvas.tsx` has several always-on point lights plus shadows.
- Many ability components create point lights.
- High settings default to high DPR, 4096 shadow maps, high reflections, and high environment density.

### Plan

1. Create a dynamic light manager.
   - Register requested lights with priority, position, color, intensity, radius, lifetime.
   - Render only top N lights by importance and distance.
   - Default N: 4 on low/medium, 8 on high, 12 on ultra.

2. Replace low-value point lights.
   - Use emissive materials, additive sprites, shader glow, or bloom-like fake sprites.
   - Remove per-player beacon lights and most projectile lights.

3. Shadow budgets.
   - Competitive default: shadows medium or low, 1024/2048 maps, no dressing shadows.
   - High/ultra can retain 4096 maps.
   - Consider updating shadow camera only on map/setting changes.

4. Reflection budgets.
   - Keep `Environment frames={1}`, but lower default reflection resolution.
   - Disable in competitive mode.

5. Adaptive quality.
   - If p95 frame time exceeds threshold for N seconds, reduce environment density, DPR cap, dynamic light count, particle density.
   - Never change gameplay-critical visibility without user opt-in.

6. Make first-run defaults performance-oriented.
   - Add a `graphicsPreset`: `competitive`, `balanced`, `cinematic`.
   - Default to `balanced` or `competitive`, not current high-everything.

Files:

- `apps/client/src/components/game/GameCanvas.tsx`
- `apps/client/src/components/game/visualQuality.ts`
- `apps/client/src/store/settingsStore.ts`
- Ability effect files with `pointLight`

Expected impact:

- Lower GPU frame time.
- Fewer shader/light interactions.
- More stable first-run experience.

Validation:

- Compare draw calls, lights, shadow map size, and frame time across presets.
- Verify readability of teams, projectiles, impacts, and objectives.

## Phase 11: Atmosphere, Particles, and Impact Effects

Goal: keep atmosphere and combat effects pretty without saturating CPU buffer updates.

### Current Hotspots

- `WorldAtmosphere.tsx` updates particle buffers at 30Hz by looping over profile counts.
- `VoidRay` has 200 particles per ray and many nested meshes.
- `VoidZone`, `FrostStorm`, terrain impacts, and airstrikes each own their own particle loops.
- Several effects use repeated `Array.from` or per-render maps.

### Plan

1. Move long-lived atmosphere to shaders.
   - For weather particles, keep initial positions and compute motion in shader with time uniforms where possible.
   - CPU only handles occasional wrap/reset or uses modulo math in shader.

2. Quality-scale effect particle counts.
   - Tie `PARTICLE_COUNT`, smoke/debris counts, and atmosphere counts to `environmentQuality` or a new `effectsQuality`.
   - Hard cap total active particles.

3. Pool terrain impacts.
   - `TerrainImpactEffectsManager` should use fixed pools and instanced geometry.
   - Avoid mounting many child meshes per impact.

4. Consolidate time uniforms.
   - One shared global time uniform for compatible shader materials.
   - Avoid each projectile updating a shared material multiple times per frame.

5. Prefer billboards for smoke/sparks.
   - Use instanced quads or points instead of many mesh spheres/boxes.

Files:

- `apps/client/src/components/game/WorldAtmosphere.tsx`
- `apps/client/src/components/game/TerrainImpactEffects.tsx`
- `apps/client/src/components/game/phantom/voidRay.tsx`
- `apps/client/src/components/game/phantom/voidZone.tsx`
- `apps/client/src/components/game/glacier/frostStorm.tsx`
- `apps/client/src/components/game/blaze/airstrike.tsx`

Expected impact:

- Lower CPU frame work from particle buffer writes.
- Lower draw/mesh count during ultimate effects.
- Fewer shader/material updates per frame.

Validation:

- Track active particles and CPU time in each effect scenario.
- Verify atmosphere remains visible and combat readable at each quality level.

## Phase 12: Bundle, Loading, and Dependency Optimization

Goal: reduce initial parse/compile time and avoid shipping heavyweight systems before they are needed.

### Current Hotspots

- Client imports Solana wallet dependencies at startup.
- `main.tsx` globally polyfills `Buffer`.
- Rapier, Three, Drei, R3F, wallet auth, lobby UI, and game rendering likely land in a large initial bundle.
- Vite config has no manual chunking/analyzer.

### Plan

1. Lazy-load wallet/auth.
   - Move `@solana/web3.js`, `bs58`, and `Buffer` polyfill behind wallet connect flow.
   - Keep anonymous/local play path free of Solana dependencies if supported.

2. Route-level code splitting.
   - Lazy-load game canvas only when entering a match.
   - Lazy-load heavy hero preview canvas only when opening hero pages/select.
   - Lazy-load settings and console if not first-screen.

3. Manual chunks.
   - `three-vendor`: three, @react-three/fiber, @react-three/drei.
   - `physics-vendor`: Rapier.
   - `network-vendor`: colyseus.js.
   - `wallet-vendor`: Solana, bs58, buffer.
   - Evaluate cache hit and parse costs.

4. Add bundle analyzer.
   - Use `rollup-plugin-visualizer` or equivalent in an opt-in script.
   - Track bundle size budget in CI or local script.

5. Preload intentionally.
   - Preload Rapier and game chunks when player enters lobby or match loading.
   - Prewarm shader/material resources during loading screens.

Files:

- `apps/client/src/main.tsx`
- `apps/client/src/contexts/WalletContext.tsx`
- `apps/client/src/App.tsx`
- `apps/client/vite.config.ts`
- `apps/client/package.json`

Expected impact:

- Faster initial menu/lobby startup.
- Less JS parse/compile before the player chooses a path.
- Fewer first-use hitches.

Validation:

- Compare bundle visualizer before/after.
- Compare cold load time to menu, lobby, and match-ready state.

## Phase 13: Logging and Development Profiling Hygiene

Goal: make dev builds profileable and production logs intentional.

### Current Hotspots

`rg` found widespread `console.log` in:

- `GameRoom.ts`, `LobbyRoom.ts`, `abilityHandlers.ts`
- `NetworkContext.tsx`, `gameMessageHandlers.ts`
- `OtherPlayers.tsx`
- `usePhysics.ts`, `WalletContext.tsx`

Production Vite drops console calls in client builds, but development gameplay still pays logging cost. Server production does not automatically drop logs.

### Plan

1. Add shared logger utility.
   - Levels: debug, info, warn, error.
   - Namespaces: network, room, physics, effects, auth, perf.
   - Runtime flags: `VITE_DEBUG_NETWORK`, `DEBUG_ROOM`, etc.

2. Sample high-frequency logs.
   - Player sync logs should never print per tick.
   - Other player mount/count logs should be debug-only.
   - Poll/ghost logs should be removed with polling cleanup.

3. Keep structured perf summaries.
   - Replace free-form logs with sampled metrics.

Files:

- `apps/client/src/utils/logger.ts`
- `apps/server/src/utils/logger.ts`
- All high-frequency console call sites.

Expected impact:

- Cleaner profiling and lower dev overhead.
- Fewer production log bursts.

Validation:

- Dev match with default env should not spam console.
- Enabling debug namespaces should restore targeted detail.

## Phase 14: Data Structures and Store Shape

Goal: stop using React state for high-frequency visual entities.

### Current Hotspots

- Projectile arrays use append/spread/filter/map.
- Duplicate ID checks use `.some()`.
- `pendingInputs` uses array append/filter.
- Store actions often create new Maps/objects even for visual-only changes.

### Plan

1. Classify state by update rate.
   - 60fps visual: vanilla store/ref/pool, no React subscription.
   - 20Hz network transform: visualStore plus stable Map mutation.
   - Event-driven UI: Zustand state.
   - Persistent settings/auth/lobby: Zustand state.

2. Replace high-volume arrays.
   - Use object pools with free lists for projectiles/effects.
   - Keep ID maps for duplicate prevention and removal.

3. Batch input history.
   - Use fixed ring buffer for `pendingInputs` rather than repeated array filter.

4. Add "no-op set" guards.
   - Do not call `set` if values are equal.
   - Useful for fuel, targeting validity, slide intensity, timers.

Files:

- `apps/client/src/store/gameStore.ts`
- `apps/client/src/store/visualStore.ts`
- `apps/client/src/store/slices/projectiles.ts`
- `apps/client/src/store/slices/glacier.ts`
- `apps/client/src/components/game/PlayerController.tsx`

Expected impact:

- Lower allocations and React updates.
- Cleaner mental model of authoritative vs visual state.

Validation:

- React Profiler shows UI re-renders only on semantic changes.
- Heap allocation during combat is reduced.

## Phase 15: Audio and Asset Runtime

Goal: remove first-use audio stalls and keep memory bounded.

### Current Hotspots

- `useAudio.ts` lazily fetches/decodes sounds.
- Shared audio cache never has a clear budget.
- Hero abilities can trigger first-use decode during combat.

### Plan

1. Preload by phase.
   - Menu sounds on app start.
   - Lobby/music on lobby entry.
   - Selected hero SFX during hero select/loading.
   - Common combat sounds before match starts.

2. Decode scheduling.
   - Decode during loading screen with progress.
   - Use idle callbacks where supported.

3. Cache budget.
   - Keep common sounds permanently.
   - Evict non-selected hero sounds after match or on memory pressure.

4. Audio sprites if request count becomes an issue.

Files:

- `apps/client/src/hooks/useAudio.ts`
- `apps/client/src/components/ui/MatchLoadingScreen.tsx`
- `apps/client/public/sounds/*`

Expected impact:

- No first-fire audio hitch.
- Predictable memory use.

Validation:

- First ability per hero plays immediately after loading.
- Audio context resumes reliably after user interaction.

## Implementation Order

### Sprint 1: Stop Waste First

1. Add perf harness and counters.
2. Remove active-game 50ms polling once `playerStates` is installed.
3. Split server messages into transform/vital/match streams.
4. Finish rocket instancing integration.
5. Remove or gate high-frequency console logs.

Why first: these are the clearest high-impact issues and reduce work before deeper rendering refactors.

### Sprint 2: Projectile and Effect Architecture

1. Central projectile simulation system.
2. Pools for visual effects.
3. Instanced dire balls, impacts, bombs, and hook projectiles.
4. Dynamic light manager with strict budgets.
5. Effect quality scaling.

Why second: projectile spam is the most likely real-match FPS killer.

### Sprint 3: Player and Scene Rendering

1. Remote player LOD.
2. Nameplate overlay rewrite.
3. GameCanvas subscription cleanup.
4. Static/dynamic scene split.
5. Avatar material/geometry caching.

Why third: scales match size from "works for a few players" to "works for 5v5 plus bots."

### Sprint 4: Voxel and Physics

1. Greedy meshing.
2. Geometry/accessor caching.
3. Heightfield/top-surface precompute.
4. Collider merge/spatial activation.
5. Batched physics queries.

Why fourth: bigger refactor, high payoff for map load and server/client collision.

### Sprint 5: Bot and Server Scalability

1. Spatial player index.
2. Bot LOS cache and blackboard throttling.
3. Area-effect candidate queries.
4. Server tick budget enforcement.

Why fifth: depends on measurement and shared terrain improvements.

### Sprint 6: Startup and Polish

1. Lazy wallet/Solana bundle.
2. Route and vendor chunking.
3. Audio preloading.
4. Adaptive quality and first-run preset.
5. Bundle budgets.

Why sixth: improves first impression and smoothness after runtime hotspots are controlled.

## Detailed Fix Checklist

### P0 Checklist

- [ ] Add client/server perf counters.
- [ ] Remove active-game `setupPollingSync` or make it fallback-only.
- [ ] Ensure remote player transforms update without replacing whole player objects.
- [ ] Split `playerStates` into `playerTransforms`, `playerVitals`, `matchSnapshot`.
- [ ] Integrate `InstancedRockets` in `RocketsManager`.
- [ ] Move rocket collision out of per-rocket React component.
- [ ] Stop `GameCanvas` subscribing to projectile arrays.
- [ ] Add logger and gate high-frequency console output.

### P1 Checklist

- [ ] Add projectile/effect pools.
- [ ] Add central frame systems.
- [ ] Instanced dire balls.
- [ ] Instanced bombs and airstrike debris.
- [ ] Instanced hook projectiles/ropes where feasible.
- [ ] Terrain impact pooling.
- [ ] Dynamic light manager.
- [ ] Player LOD tiers.
- [ ] Nameplate overlay rewrite.
- [ ] Greedy voxel meshing.
- [ ] Heightfield/top-surface map.
- [ ] Bot spatial index and LOS cache.

### P2 Checklist

- [ ] Lazy-load wallet/Solana dependencies.
- [ ] Add bundle analyzer script.
- [ ] Add manual chunks.
- [ ] Add audio preload pipeline.
- [ ] Add adaptive quality.
- [ ] Add no-op guards in store setters.
- [ ] Replace pending input array with ring buffer.

## Risk Notes

1. Network stream splitting is high impact but touches server/client contracts.
   - Mitigation: add old/new handlers side by side behind a feature flag, then remove the old path after parity.

2. Instancing can subtly change visuals.
   - Mitigation: keep old components as dev fallback until manual visual verification passes.

3. Greedy meshing can break atlas UVs.
   - Mitigation: test with all block types and preserve per-face material tile selection before deleting old builder.

4. Player LOD can reduce readability.
   - Mitigation: treat team, health, flag carrier, and silhouette readability as non-negotiable.

5. Bot throttling can make bots feel dumb.
   - Mitigation: separate strategic thinking from aim/movement smoothing so bots still feel responsive.

6. Adaptive quality can annoy players if it shifts visibly.
   - Mitigation: make it opt-in or only reduce hidden budgets first: DPR cap, particle count, far LOD, light count.

## Verification Matrix

No browser testing is performed by the agent. The user should verify the browser-specific items manually.

| Scenario | Metrics | Pass Criteria |
|---|---|---|
| Empty map | FPS, draw calls, triangles, memory | Stable frame time, no unexpected recurring allocations |
| 1v1 | network bytes/sec, React renders, server tick | One sync path only, p95 tick below 4ms |
| 5v5 no bots | frame p95, draw calls, transform bandwidth | p95 frame below 16.7ms competitive, bandwidth reduced 50 percent |
| 5v5 with bots | server tick by subsystem | p95 tick below 8ms, bot AI under budget |
| Blaze spam | draw calls, active lights, heap allocations | Rockets use instancing, no per-rocket mesh explosion |
| Phantom spam | particles, shader uniform updates, heap allocations | Dire balls/void rays pooled or instanced, no shader hitches |
| Hookshot spam | rope/projectile count, frame loops | Batched simulation, capped lights |
| Glacier wall rush | collider count, cleanup time | Temporary colliders expire centrally |
| High atmosphere | CPU particle time, buffer uploads | Atmosphere update cost bounded by quality |
| Map load | generation time, geometry vertex count, collider count | Greedy mesh reduces geometry substantially |
| Cold startup | JS size, parse time, time to menu | Wallet/Solana outside initial critical path |

## File-by-File Hotspot Notes

### `apps/client/src/contexts/NetworkContext.tsx`

- Starts high-frequency polling and message sync together.
- Uses broad `useGameStore()` action subscription in provider setup.
- Optimization: one active high-frequency sync path; listeners for semantic events only.

### `apps/client/src/contexts/gameMessageHandlers.ts`

- `setupPollingSync` runs every 50ms.
- `setupPlayerStatesHandler` reconstructs players repeatedly.
- Combat handlers create `THREE.Vector3` on damage events.
- Optimization: remove polling, update visual transforms in place, pool temp vectors for frequent combat visuals.

### `apps/server/src/rooms/GameRoom.ts`

- Very large room class with tick, sync, bots, physics, CTF, dev NPCs.
- `broadcastPlayerStates` sends full snapshots at 20Hz.
- Bot AI does repeated player scans and LOS samples.
- Terrain queries use repeated grid/chunk lookup and downward scans.
- Optimization: split sync streams, spatial index, bot throttling, heightfield, module extraction.

### `apps/client/src/components/game/GameCanvas.tsx`

- Top-level subscriptions to projectile arrays.
- Always-on high visual quality scene features.
- Multiple scene point lights.
- Optimization: stable scene split, effect managers own subscriptions, dynamic light budget, adaptive presets.

### `apps/client/src/components/game/blaze/rockets.tsx`

- Still renders old `RocketEffect` components.
- Filters active rockets in render.
- Each rocket checks physics and all players.
- Optimization: integrate `InstancedRockets`; centralized projectile simulation/collision.

### `apps/client/src/components/game/effects/instanced/InstancedRockets.tsx`

- Good foundation but needs integration.
- Has fixed 50 rocket slots and six instanced part groups.
- Optimization: use with manager; avoid scanning all 50 slots if active count is tiny by tracking active slots.

### `apps/client/src/components/game/phantom/direBall.tsx`

- Shared materials are good.
- Each ball owns particle geometry, collision loop, player scan, and component frame loop.
- Optimization: instanced/pool dire balls and central collision.

### `apps/client/src/components/game/phantom/voidRay.tsx`

- High particle count and multiple nested geometry effects.
- Optimization: quality-scaled particles, shared global time uniform, instanced endpoints/particles.

### `apps/client/src/components/game/phantom/voidZone.tsx`

- Per-zone particles and interval cleanup.
- Optimization: pooled zone renderer and server-driven expiry.

### `apps/client/src/components/game/OtherPlayers.tsx`

- `Html` nameplates, per-player beacons/lights, rich body, multiple frame callbacks.
- Optimization: LOD, shared overlay, remove/cap lights, central remote player system.

### `apps/client/src/components/game/HeroVoxelBody.tsx`

- Rich mesh-per-part body and per-body animation loop.
- Optimization: geometry/material caching, simplified remote LOD, possible instancing by hero/team.

### `apps/client/src/components/game/WorldAtmosphere.tsx`

- CPU-updated particle buffers at 30Hz.
- Optimization: shader motion, quality caps, shared global time.

### `apps/client/src/components/game/procedural/meshBuilder.ts`

- Greedy helper exists but is unused in final geometry path.
- Optimization: actual greedy meshing per axis, cache block accessor and geometries.

### `apps/client/src/store/slices/projectiles.ts`

- Array spread/filter/map for visual effects.
- Duplicate detection with `.some()`.
- Optimization: pools/registries for visual effects, no-op set guards, ID map.

### `apps/client/src/store/gameStore.ts`

- Good attempt to keep player Map reference stable for transform updates.
- Still builds `snapshotIds = new Set(state.players.map(...))`.
- `pendingInputs` array filter can become ring buffer.
- Optimization: split transform/semantic paths and reduce allocations.

### `apps/client/src/store/settingsStore.ts`

- Defaults to high visual quality.
- Optimization: add competitive/balanced presets and adaptive quality.

### `apps/client/src/contexts/WalletContext.tsx` and `apps/client/src/main.tsx`

- Solana and Buffer load on startup.
- Optimization: lazy wallet flow and conditional polyfill.

## Definition of Done

The optimization push is done when:

- Measurement exists and is used for every major change.
- Active gameplay has one high-frequency network sync path.
- Server sends compact transform updates and lower-rate semantic snapshots.
- Projectile spam uses instancing/pooling instead of many React components.
- Remote players have LOD and cheaper nameplates.
- Dynamic lights are capped.
- Procedural terrain uses greedy meshing and faster terrain queries.
- Bot AI stays within tick budget.
- Default graphics are stable on ordinary hardware, with cinematic visuals still available.
- Startup does not eagerly load wallet-only dependencies.
