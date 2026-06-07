# Skill Stutter Optimization Plan

## Scope

User-observed issue: noticeable stutters during some skills, especially Phantom primary fire / left click.

This pass focuses on hotspots that can create short main-thread or GPU stalls during ability use:

- Spawn-time allocations.
- Per-projectile `useFrame` work.
- Per-frame material/geometry churn.
- Projectile collision scans.
- Impact effects triggered by frequent projectiles.
- First-use shader/audio/resource hitches.

Browser testing is intentionally left to the user per repo instruction. Agent validation for this plan should be static analysis, lint/typecheck/build, and targeted unit tests for extracted pure systems.

## Summary Diagnosis

The previous optimization pass improved broad pressure, but Phantom still has several hot paths that line up with the reported stutter:

1. Dire Ball is still modeled as one React component per projectile, each with its own `useFrame`, collision work, particle buffer, mesh tree, and store removal path.
2. Shadow Step arrival allocates new materials every frame for animated rings.
3. Terrain impacts, including Phantom Dire Ball impacts, are still one React component per burst with many child meshes/materials and a point light.
4. Blink/Void Ray/Void Zone construct short-lived geometries/material clones on spawn, then run independent per-effect frame loops.
5. Projectile state still uses copy-on-write arrays for high-rate projectile add/remove/cleanup.
6. Phantom visual resources are partially prewarmed, but the hot Dire Ball and impact paths are not fully moved to shared cached geometries, pools, or renderer-level precompilation.

## Evidence From Static Pass

| Priority | Hotspot | Evidence | Why it can stutter |
| --- | --- | --- | --- |
| P0 | Dire Ball per-projectile React/render/frame loop | `apps/client/src/components/game/phantom/direBall.tsx:231`, `apps/client/src/components/game/phantom/direBall.tsx:275`, `apps/client/src/components/game/phantom/direBall.tsx:503` | Every active left-click shot owns a component, a `useFrame`, several meshes, collision checks, and particle buffer updates. |
| P0 | Dire Ball spawn allocations | `apps/client/src/components/game/phantom/direBall.tsx:253`, `apps/client/src/components/game/phantom/direBall.tsx:413`, `apps/client/src/components/game/phantom/direBall.tsx:424` | Each shot creates a particle `BufferGeometry`, typed arrays, JSX geometries/materials, and orientation objects. |
| P0 | Dire Ball collision scan | `apps/client/src/components/game/phantom/direBall.tsx:310`, `apps/client/src/components/game/phantom/direBall.tsx:339` | Each ball raycasts terrain and scans all players in its own frame callback. |
| P0 | Shadow Step arrival material churn | `apps/client/src/components/game/phantom/shadowStepArrival.tsx:38`, `apps/client/src/components/game/phantom/shadowStepArrival.tsx:58` | Allocates `new THREE.MeshBasicMaterial` every frame for each ring. This is a direct CPU/GPU resource churn bug. |
| P0 | Terrain impact burst cost | `apps/client/src/components/game/TerrainImpactEffects.tsx:342`, `apps/client/src/components/game/TerrainImpactEffects.tsx:422`, `apps/client/src/components/game/TerrainImpactEffects.tsx:518`, `apps/client/src/components/game/TerrainImpactEffects.tsx:546` | Each hit can mount a burst with several meshes, particle meshes, smoke meshes, a light, and another per-burst `useFrame`. |
| P1 | Phantom effect manager frame filtering | `apps/client/src/components/game/PhantomEffects.tsx:42`, `apps/client/src/components/game/PhantomEffects.tsx:46`, `apps/client/src/components/game/PhantomEffects.tsx:59` | Filters and rewrites effect arrays every frame, then remounts keyed children when counts change. |
| P1 | Blink spawn allocations | `apps/client/src/components/game/phantom/blinkTeleport.tsx:27`, `apps/client/src/components/game/phantom/blinkTeleport.tsx:63`, `apps/client/src/components/game/phantom/blinkTeleport.tsx:181` | Creates trail/burst geometries and clones material in render for a short-lived effect. |
| P1 | Void Ray heavy spawn and frame path | `apps/client/src/components/game/phantom/voidRay.tsx:273`, `apps/client/src/components/game/phantom/voidRay.tsx:286`, `apps/client/src/components/game/phantom/voidRay.tsx:395`, `apps/client/src/components/game/phantom/voidRay.tsx:475` | Builds tube geometries/material clones and updates 250 particles plus collision in one instance loop. |
| P1 | Void Zone heavy frame path | `apps/client/src/components/game/phantom/voidZone.tsx:271`, `apps/client/src/components/game/phantom/voidZone.tsx:275`, `apps/client/src/components/game/phantom/voidZone.tsx:354`, `apps/client/src/components/game/phantom/voidZone.tsx:402` | Per-zone cloned materials, particle/debris buffers, particle loops, random resets, and player scans. |
| P1 | Shadow Step targeting allocations | `apps/client/src/components/game/phantom/shadowStepIndicator.tsx:316`, `apps/client/src/components/game/phantom/shadowStepIndicator.tsx:327`, `apps/client/src/components/game/phantom/shadowStepIndicator.tsx:342`, `apps/client/src/components/game/phantom/shadowStepIndicator.tsx:490` | Allocates vectors and clones target data every frame while targeting is active. |
| P1 | Projectile store array churn | `apps/client/src/store/slices/projectiles.ts:178`, `apps/client/src/store/slices/projectiles.ts:190`, `apps/client/src/store/slices/projectiles.ts:210`, `apps/client/src/store/slices/projectiles.ts:255` | High-rate projectiles allocate arrays on add/remove/cleanup and notify subscribers. |
| P2 | Audio first-use hardening | `apps/client/src/hooks/useAudio.ts:216`, `apps/client/src/hooks/useAudio.ts:362` | Hero sounds can preload, but `playSound` still awaits load if preload did not finish before first ability use. |

## Plan

### P0. Add Stutter Instrumentation Before Larger Refactors

Goal: make the next implementation pass measurable and keep changes honest.

Implement:

1. Extend `apps/client/src/utils/perfMarks.ts`.
   - Add per-system timers, for example `recordSystemTime(name, ms)`.
   - Track rolling p95/p99 for `phantomProjectiles`, `phantomEffects`, `terrainImpacts`, `physicsQueries`, and `audioLoads`.
   - Keep sample windows bounded.
2. Wrap hot systems with timing.
   - `DireBallsManager` or the new Dire Ball system.
   - `TerrainImpactEffectsManager`.
   - `PhantomEffectsManager`.
   - Shadow Step targeting.
3. Show the timings in `apps/client/src/components/game/PerfMonitor.tsx`.
   - Add a compact "Effects" section with the top 3 system costs.
   - Keep the overlay cheap: no sorting large maps every render.
4. Add one-shot spawn markers around ability triggers.
   - `usePhantomAbilities.fireDireBall`.
   - `triggerTerrainImpact('phantom_dire_ball', ...)`.
   - `playPhantomBasic`.

Acceptance checks:

- `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass.
- The perf snapshot remains bounded in memory.
- No browser automation required.

### P0. Replace Dire Ball Component Fanout With One Pooled System

Goal: Phantom left-click should not mount a new React component tree or register a new frame callback per shot.

Implement:

1. Create a fixed-capacity Dire Ball runtime pool.
   - Capacity: start with current `PROJECTILE_LIMITS.direBalls` of 96.
   - Store active flags, id, owner id/team, position, velocity, normalized direction, speed, spawn time, and particle phase data in mutable records or typed arrays.
   - Keep a free list so add/remove is O(1) and allocation-free after initialization.
2. Change `addDireBall` usage to feed the pool/registry.
   - Keep store compatibility if server/network code still expects `direBalls`.
   - Do not let visual-only cleanup cause broad React subscriptions.
   - If retaining store arrays temporarily, bridge store events into the pool and make the renderer consume the pool directly.
3. Replace `<DireBall>` mapping with a single system component.
   - Remove `DireBalls` render-time `filter` and `map`.
   - One `useFrame` updates every active ball.
   - Use `getFrameClock()` rather than `Date.now()` inside the hot loop.
4. Render with instancing/shared buffers.
   - `InstancedMesh` for core sphere.
   - `InstancedMesh` for glow sphere.
   - Optional second instanced mesh for small inner core.
   - Single `Points` geometry for all trail particles, sized `MAX_DIRE_BALLS * PARTICLES_PER_BALL`.
   - Update instance matrices and only the active particle ranges.
5. Centralize collision.
   - Precompute local player/team and enemy list once per frame.
   - Use squared distance for player hit checks.
   - Cache normalized direction and speed at spawn, so terrain sweep does not normalize every frame.
   - Batch removals after the loop to avoid mutating state while iterating.
6. Trigger terrain impacts through a pooled impact API.
   - Keep the visual event, but avoid spawning a large React impact tree for every shot.

Acceptance checks:

- Static scan shows no active `<DireBall>` per projectile render path.
- Static scan shows no per-ball `useFrame`.
- Static scan shows no Dire Ball particle `BufferGeometry` created per shot.
- Phantom left-click can sustain rapid fire with bounded object/material/geometry counts.

Suggested files:

- `apps/client/src/components/game/phantom/direBall.tsx`
- `apps/client/src/store/slices/projectiles.ts`
- `apps/client/src/components/game/systems/GameplayFrameSystems.tsx`
- `apps/client/src/components/game/effectResources.ts`
- `apps/client/src/utils/perfMarks.ts`

### P0. Fix Shadow Step Arrival Per-Frame Material Allocation

Goal: remove a concrete per-frame resource churn bug.

Implement:

1. Replace `new THREE.MeshBasicMaterial` inside `useFrame`.
2. Give each ring a stable material.
   - Either create ring materials with `useMemo`.
   - Or use refs to existing JSX materials and update only opacity/color.
3. Use shared/cached ring geometry where possible.
4. Dispose cloned materials only if the component still owns them and they are not shared.

Acceptance checks:

- Static scan shows no `new THREE.*Material` inside `ShadowStepArrivalEffect.useFrame`.
- `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass.

Suggested file:

- `apps/client/src/components/game/phantom/shadowStepArrival.tsx`

### P0. Pool Terrain Impact Effects For Frequent Projectile Hits

Goal: Dire Ball impact should be cheap and bounded.

Implement:

1. Replace `terrainImpactEffects.filter(...)` every frame with a fixed-capacity impact pool.
2. Split high-frequency impact visuals from large hero-specific impact visuals.
   - `phantom_dire_ball` should use a compact pooled/instanced burst.
   - Larger impacts can remain richer but should still avoid per-frame allocations.
3. Replace per-particle mesh maps with instanced meshes or one `Points` buffer.
4. Remove or heavily budget point lights for rapid impact kinds.
   - If a light remains, reuse a small fixed light pool.
5. Move impact animation into one manager `useFrame`.

Acceptance checks:

- Impact count is bounded.
- No impact effect creates unbounded React child meshes during left-click spam.
- No `TerrainImpactBurst` per-effect `useFrame` remains for high-frequency impact kinds.

Suggested file:

- `apps/client/src/components/game/TerrainImpactEffects.tsx`

### P0. Prewarm Phantom Visual And Audio Resources At Match/Hero Load

Goal: first shot, first blink, or first shadow step should not compile/decode on the action frame.

Implement:

1. Add `prewarmPhantomEffects()`.
   - Dire Ball materials and shared geometries.
   - Dire Ball instanced meshes/buffers if renderer is available.
   - Blink materials.
   - Shadow arrival materials.
   - Void Ray/Void Zone materials.
   - Terrain impact materials/geometries for `phantom_dire_ball`.
2. Call prewarm when the player selects Phantom and during match loading.
3. If renderer access is available in `GameCanvas.onCreated`, compile representative Phantom materials/geometries with the renderer.
4. Harden audio preload.
   - Ensure `preloadHeroSounds('phantom')` is awaited before match start when Phantom is selected.
   - Add a perf/debug signal when `playSound('phantomBasic')` has to await `loadSound` during gameplay.

Acceptance checks:

- First Phantom primary after match load does not create Dire Ball materials/geometries.
- First `phantomBasic` play does not fetch/decode on the ability frame when preload succeeded.

Suggested files:

- `apps/client/src/components/game/effectResources.ts`
- `apps/client/src/components/game/phantom/direBall.tsx`
- `apps/client/src/hooks/useAudio.ts`
- `apps/client/src/components/ui/MatchLoadingScreen.tsx`
- `apps/client/src/components/game/GameCanvas.tsx`

## P1. Secondary Phantom Hotspots

### Replace Phantom Effect Array Filtering With A Small Registry

Current manager filters and rewrites `blinkEffects` and `shadowArrivals` every frame.

Implement:

- Use a fixed-capacity registry with active flags and end times.
- Sweep at a capped cadence or inside one manager loop without array allocation.
- Trigger React updates only on active count transitions.

Suggested files:

- `apps/client/src/components/game/PhantomEffects.tsx`
- `apps/client/src/components/game/phantom/index.ts`

### Pool Blink Teleport Effect Resources

Implement:

- Remove `riftMaterial.clone()` from JSX render.
- Use stable start/end rift materials created once per effect, or pool instances.
- Fill trail particle buffers directly without `Vector3.clone().lerp(...)` in a loop.
- Consider one pooled `BlinkTeleportRenderer` if blink spam or multiple players make it noticeable.

Suggested file:

- `apps/client/src/components/game/phantom/blinkTeleport.tsx`

### Optimize Void Ray And Void Zone

Implement:

- Cache/reuse Void Ray spiral geometries instead of rebuilding `TubeGeometry` per ray.
- Reduce or quality-scale Void Ray particle counts.
- Move player collision into one system loop and use squared distance.
- Avoid `Math.random()` in hot frame loops where deterministic phase data can be precomputed.
- Convert Void Zone particle/debris loops to typed arrays with one manager update.
- Use `useEffectLOD` or quality settings for particle counts and render complexity.

Suggested files:

- `apps/client/src/components/game/phantom/voidRay.tsx`
- `apps/client/src/components/game/phantom/voidZone.tsx`
- `apps/client/src/components/game/useEffectLOD.ts`

### Fix Shadow Step Targeting Allocations And Callback Rate

Implement:

- Replace `camera.position.clone()` and `new THREE.Vector3(...)` in `useFrame` with refs/temp vectors.
- Avoid `targetPositionRef.current.clone()` every frame.
- Call `onTargetUpdate` only when validity changes, position changes meaningfully, or at a capped cadence.
- Consider throttling expensive validation/raycast checks to 20-30 Hz while still animating the visual every frame.

Suggested file:

- `apps/client/src/components/game/phantom/shadowStepIndicator.tsx`

## P2. Shared Architecture Cleanup

### Move High-Rate Visual Projectiles Out Of Copy-On-Write Store Arrays

Implement:

- Keep server-authoritative gameplay state in Zustand where needed.
- Move visual-only transient effects to registries/pools with explicit subscription/version counters.
- Avoid array spread/filter/map for high-rate projectile lifetimes.
- Batch store notifications when state changes must be exposed to React.

Suggested file:

- `apps/client/src/store/slices/projectiles.ts`

### Standardize Frame Clock Usage

Implement:

- Use `getFrameClock()` in per-frame effect systems.
- Remove repeated `Date.now()` from hot `useFrame` paths.
- Reserve `Date.now()` for event creation or non-frame code.

Suggested files:

- `apps/client/src/utils/frameClock.ts`
- `apps/client/src/components/game/phantom/*.tsx`
- `apps/client/src/components/game/TerrainImpactEffects.tsx`

### Reduce Server-Side Dirty Signature Work

This is lower confidence for the user-visible Phantom stutter, but it is still worth addressing for match-scale smoothness.

Implement:

- Replace per-player `JSON.stringify(...)` dirty signatures in `apps/server/src/rooms/GameRoom.ts` with explicit scalar comparisons or event-driven dirty flags.
- Keep network payload generation allocation-light.

## Recommended Implementation Order

1. Instrumentation and Shadow Step arrival material fix.
   - Fastest proof and lowest risk.
2. Dire Ball pooled system and instanced renderer.
   - Highest relevance to Phantom left-click.
3. Terrain impact pool for `phantom_dire_ball`.
   - Handles the hit-frame stutter side of left-click.
4. Phantom resource/audio prewarm hardening.
   - Removes first-use hitches.
5. Blink/Shadow Step/Void Ray/Void Zone secondary optimizations.
   - Cleans the remaining skill stutters.
6. Store/registry cleanup.
   - Consolidates the architecture once the main hot path has moved.

## Validation Matrix

Agent-side checks:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- Static scan: no `new THREE.*Material` in `useFrame`.
- Static scan: no per-projectile `<DireBall>` render map.
- Static scan: no per-shot Dire Ball `BufferGeometry`.
- Unit tests for any extracted pool/free-list helpers.

User-side manual/browser checks:

- Phantom primary first shot after selecting Phantom.
- Phantom primary sustained spam into empty space.
- Phantom primary sustained spam into terrain, triggering impacts.
- Phantom primary with several other players/bots alive.
- Shadow Step targeting and arrival.
- Blink repeated use.
- Void Ray and Void Zone first use and repeated use.
- Perf overlay p95/p99 while repeating the scenarios above.

## Done Criteria

- Phantom left-click no longer creates new React component trees per shot.
- Phantom left-click uses one frame system and bounded renderer resources.
- Dire Ball impact effects are pooled and bounded.
- Shadow Step arrival has no per-frame material allocation.
- First-use Phantom materials/audio are prewarmed before gameplay input.
- Perf overlay can identify which effect subsystem owns any remaining spike.
- The codebase has no new browser-test dependency for validation.
