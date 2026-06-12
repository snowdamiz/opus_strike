# Game World Performance Optimization Plan

Date: 2026-06-12

## Scope

This audit covers the game world path: procedural map generation, terrain chunks, mesh building, collider generation/loading, movement collision, world dressing, player/viewmodel models, and GPU quality controls.

Per `AGENTS.md`, no browser testing was performed. Evidence below comes from static code audit and non-browser Node/package benchmarks.

## Baseline Evidence

### Commands Run

```bash
pnpm --filter @voxel-strike/physics bench:movement
pnpm --filter @voxel-strike/server bench:room-load
pnpm --filter @voxel-strike/client exec tsx -e "<map/mesh timing script>"
node --input-type=module -e "<map stats script>"
```

### Current Numbers

- Physics movement benchmark: average `0.014ms`, p95 `0.029ms`, p99 `0.073ms`.
- Server room benchmark:
  - movement queue, 8-player burst: average `0.141ms`, p95 `0.190ms`, p99 `0.331ms`.
  - shared movement, 8 players: average `0.224ms`, p95 `0.457ms`, p99 `0.594ms`.
  - spatial rebuild/query: average `0.014ms`, p95 `0.018ms`, p99 `0.052ms`.
- Seed `20260611` map generation:
  - total generation: `1405ms`, above the current `900ms` budget.
  - semantic repairs: `564ms`.
  - collider generation: `225ms`.
  - terrain constraints: `190ms`.
  - voxelization: `146ms`.
  - chunk extraction: `122ms`.
- Seed `20260611` generated world:
  - map size: `281 x 80 x 224`.
  - renderable chunks: `698`.
  - regions: `78`.
  - solid blocks: `1,586,008`.
  - colliders: `5,215`.
- Sync mesh build for seed `20260611`:
  - total region mesh build: `1862ms`.
  - average region: `23.9ms`.
  - p95 region: `58.5ms`.
  - vertices: `305,788`.
  - triangles: `152,894`.
- Seed corpus spot check:
  - seed `1`: `1,831,488` solid blocks, above `maxSolidBlocks: 1,750,000`.
  - seed `123456789`: `2,037,442` solid blocks, above `maxSolidBlocks: 1,750,000`.

## Existing Strengths

- Chunk mesh building already has a worker path in `apps/client/src/components/game/procedural/meshBuild.worker.ts`.
- Geometry buffers are transferred from the worker instead of cloned.
- The client has a map prep cache in `apps/client/src/utils/mapWarmup/mapPrepCache.ts`.
- World dressing uses instanced meshes in `apps/client/src/components/game/procedural/WorldDressing.tsx`.
- Remote player LOD tiers already exist in `apps/client/src/components/game/OtherPlayers.tsx`.
- Dynamic light budgets and adaptive quality already exist in `apps/client/src/components/game/GameCanvas.tsx`.
- Client and server both cache the voxel collision world for movement simulation.

## Priority 0: Add Real Performance Telemetry

### Problem

The code has several estimates and budgets, but the highest-value runtime numbers are not emitted consistently. The terrain stats estimate roughly `1.14M` balanced triangles for seed `20260611`, while the actual mesh build produced about `153k` triangles. That mismatch makes optimization decisions noisier than they need to be.

### Target Files

- `apps/client/src/components/game/procedural/meshBuild.worker.ts`
- `apps/client/src/components/game/procedural/meshBuilder.ts`
- `apps/client/src/components/game/procedural/VoxelMap.tsx`
- `apps/client/src/components/game/GameCanvas.tsx`
- `packages/shared/src/maps/procedural/generator.ts`
- `packages/shared/src/maps/procedural/construction.ts`

### Actions

1. Emit actual mesh stats from worker responses:
   - region id
   - build time
   - vertex count
   - triangle count
   - transferred byte count
2. Record map generation stage timings into a small client-visible diagnostic object.
3. Add a world performance sample hook that captures:
   - Three.js draw calls
   - triangles
   - geometries
   - textures
   - active full/simplified/marker remote players
   - active dynamic lights
   - procedural collider load progress
4. Replace or annotate conservative terrain triangle estimates with actual mesh output once geometry is built.
5. Create a fixed seed corpus for performance checks:
   - fastest seed
   - average seed
   - heavy solid-block seed
   - heavy collider seed
   - visually dense seed

### Success Gates

- Every generated map has stage timings, solid block count, collider count, renderable chunk count, actual mesh triangles, and mesh build timing.
- Performance regressions can be caught without opening a browser.
- Actual mesh stats are used for budgets instead of relying only on pre-build estimates.

## Priority 1: Cut Procedural Map Generation Time

### Problem

Map generation is currently the biggest measured CPU cost. Seed `20260611` took `1405ms`, with semantic repairs alone taking `564ms`. The current construction budget is `maxGenerationMs: 900`, so realistic seeds can miss the target.

### Target Files

- `packages/shared/src/maps/procedural/generator.ts`
- `packages/shared/src/maps/procedural/terrain.ts`
- `packages/shared/src/maps/procedural/construction.ts`

### Evidence

- `generateProceduralVoxelMap` performs terrain generation, terrain constraints, voxelization, semantic repairs, chunk extraction, and collider generation in one pipeline.
- Semantic repair functions perform multiple broad scans over the map:
  - `sealNarrowGrooveRunsForAxis`
  - `sealUnsafeCornerPockets`
  - `sealUnsafeWallNotches`
  - `sealUnsafeTrappedBasins`
  - `sealUnsafeBoundarySeams`
- Flag and spawn cleanup is repeated around sightline enforcement.

### Actions

1. Split generation timing into finer repair sub-stages so the exact worst repair pass is visible.
2. Replace repeated full-volume scans with dirty-region scans where possible:
   - spawn regions
   - flag pad regions
   - module footprints
   - boundary seam bands
   - terrain constraint bands
3. Precompute reusable masks:
   - protected flag/spawn zones
   - boundary distance bands
   - non-carvable structural cells
   - repair candidate cells
4. Combine repeated spawn/flag clearing passes into one idempotent cleanup stage after all relevant terrain mutations.
5. Add early exits to repair passes when candidate counts are zero.
6. Add seed-corpus budget tests around `generateProceduralVoxelMap`.
7. Tighten generator parameters that produce excess solid blocks. Some seeds currently exceed `maxSolidBlocks: 1,750,000`.

### Success Gates

- Seed corpus p95 generation time is at or below `900ms` on the same machine.
- No seed in the corpus exceeds `maxSolidBlocks`.
- Repair stage p95 drops by at least 40%.
- Spawn/flag semantic checks still pass for every seed in the corpus.

## Priority 1: Reduce Mesh Build And Upload Cost

### Problem

The async worker path avoids blocking the main thread, but total mesh build for seed `20260611` measured `1862ms` synchronously, with p95 region cost around `58ms`. Worker dispatch and upload still need tighter backpressure so warmup does not compete with gameplay.

### Target Files

- `apps/client/src/components/game/procedural/meshGeometryData.ts`
- `apps/client/src/components/game/procedural/meshBuild.worker.ts`
- `apps/client/src/components/game/procedural/meshBuilder.ts`
- `apps/client/src/components/game/procedural/VoxelChunkMesh.tsx`
- `apps/client/src/components/game/procedural/materials.ts`

### Evidence

- `buildVoxelRegionGeometryData` greedily scans chunk regions and creates positions, normals, uvs, tile origins, and indices.
- Worker results already transfer typed arrays.
- `prebuildVoxelRegionGeometries` frame-budgets dispatch, but not the full worker/result upload budget.
- `buildBufferGeometryFromData` duplicates UV data into `uv2` and adds `voxelTileOrigin`, increasing vertex bandwidth.

### Actions

1. Add a worker queue with explicit concurrency and result-upload budgets:
   - maximum in-flight region builds
   - maximum geometry uploads per frame
   - priority for near-player regions
2. Build nearest/visible regions first; defer far regions until after interaction is smooth.
3. Reuse region/chunk lookup structures instead of rebuilding lookup maps per region.
4. Measure whether `uv2` is required for every quality tier. Disable AO attributes for low/competitive tiers if visual impact is acceptable.
5. Pack or reduce custom attributes:
   - replace full float `voxelTileOrigin` where possible
   - consider tile id or compact integer encoding
6. Add optional mesh simplification for hidden or far terrain bands.
7. Cache mesh output by map seed, region id, and quality/material tier when feasible.

### Success Gates

- First playable frame is not blocked by far-region mesh work.
- No mesh upload frame exceeds the chosen main-thread budget.
- Region mesh p95 build time is below `25ms` or hidden fully behind worker scheduling.
- Low/competitive tiers use less vertex attribute bandwidth than high/cinematic tiers.

## Priority 1: Split Terrain Collision From Structural Colliders

### Problem

Procedural maps can produce thousands of static Rapier colliders. Seed `20260611` produced `5,215` colliders. The client amortizes collider creation, but the count still adds startup work, memory pressure, and broadphase cost.

### Target Files

- `packages/shared/src/maps/procedural/colliders.ts`
- `apps/client/src/hooks/usePhysics.ts`
- `packages/physics/src/movement/CapsuleMotor.ts`

### Evidence

- Collider generation builds full-volume `solid` and `visited` arrays, then greedily emits cuboids.
- The client creates procedural colliders over multiple frames with a per-frame cap.
- Movement already has a heightfield fast path for ground checks.

### Actions

1. Separate collision into:
   - heightfield terrain floor
   - structural walls/blocks
   - gameplay-critical blockers
2. Avoid creating Rapier cuboids for terrain that can be represented by heightfield/column intervals.
3. Generate colliders by iterating chunk block data directly instead of repeatedly calling global block lookup.
4. Add collider budgets per map profile:
   - total colliders
   - collider generation time
   - client collider load time
   - broadphase query time
5. Preserve high-fidelity colliders only around flags, spawn exits, cover modules, and traversal-critical spaces.

### Success Gates

- Static Rapier collider count drops materially on heavy seeds.
- Collider generation p95 is below `100ms`.
- Client collider loading does not interfere with first combat input.
- Movement and projectile collision parity remains correct in gameplay-critical zones.

## Priority 2: Optimize Runtime Movement Collision Queries

### Problem

Movement simulation benchmarks are currently healthy, but the collision path is object-heavy and can become expensive as player count, prediction depth, or terrain complexity grows.

### Target Files

- `packages/physics/src/movement/CapsuleMotor.ts`
- `packages/physics/src/movement/sharedSimulator.ts`
- `packages/physics/src/movement/predictionController.ts`
- `apps/client/src/movement/localPrediction.ts`
- `apps/server/src/rooms/GameRoom.ts`

### Evidence

- `collectVoxelAabbs` samples voxel blocks and calls `terrain.getGroundY` multiple times for walkable cells.
- Static AABB caching uses string keys derived from sampled grid bounds.
- Sweep tests allocate and manipulate many small vector-like objects.
- Client and server already cache collision worlds by map/revision.

### Actions

1. Add cache hit/miss telemetry for static AABB query caches.
2. Replace string cache keys with packed numeric keys or stable tuple hashing.
3. Pool/reuse AABB arrays and vector scratch objects inside hot movement loops.
4. Precompute column intervals for static terrain collision.
5. Keep the existing movement benchmarks and add a real-map benchmark using a generated procedural map.

### Success Gates

- Real-map 8-player movement p95 remains below `1ms`.
- AABB cache hit rate is visible and consistently high during normal movement.
- Allocation pressure during movement simulation is measurably lower.

## Priority 2: Reduce Player Model And Viewmodel Draw Calls

### Problem

Hero bodies and viewmodels are made from many mesh parts. That is flexible and readable, but remote players and first-person viewmodels can become draw-call heavy, especially when full remote bodies, shadows, veils, emissive effects, and dynamic accents are active.

### Target Files

- `apps/client/src/components/game/HeroVoxelBody.tsx`
- `apps/client/src/components/game/HeroViewmodel.tsx`
- `apps/client/src/components/game/OtherPlayers.tsx`
- `apps/client/src/components/game/visualQuality.ts`
- `apps/client/src/components/game/GameCanvas.tsx`

### Evidence

- `HeroVoxelBody` renders a large mesh hierarchy.
- Remote players use full/simplified/marker LODs, but full bodies can still cast shadows.
- Body opacity changes traverse the hierarchy to update materials.
- Viewmodels contain many decorative meshes and per-frame animation/effects paths.

### Actions

1. Create merged static hero-body variants per hero/team/LOD where animation does not require independent mesh transforms.
2. Share material instances globally by hero, team, opacity mode, and quality tier.
3. Disable remote-player shadows by default outside cinematic/high tiers or special cases.
4. Lower full-body remote-player caps for performance presets.
5. Prefer simplified/marker LODs sooner when the player is off-center, occluded, veiled, or distant.
6. Build lower-cost first-person viewmodel variants:
   - merge static weapon/hand pieces
   - disable decorative glows on competitive/potato
   - pool repeated pulse/highlight effects
7. Add draw-call budgets by preset and fail diagnostics when exceeded.

### Success Gates

- Remote-player draw calls scale sublinearly with lobby size.
- Competitive/potato tiers keep full remote bodies rare.
- Viewmodel draw calls are known per hero and tier.
- Shadow casters stay within preset budgets.

## Priority 2: Extend Adaptive Quality Beyond DPR/Shadows

### Problem

Adaptive quality currently steps down a few GPU-heavy features after sustained slow frames. It should also control world and model complexity.

### Target Files

- `apps/client/src/components/game/GameCanvas.tsx`
- `apps/client/src/components/game/visualQuality.ts`
- `apps/client/src/components/game/OtherPlayers.tsx`
- `apps/client/src/components/game/procedural/WorldDressing.tsx`

### Actions

1. Add adaptive controls for:
   - dynamic light count
   - remote full-body count
   - viewmodel decorative tier
   - world dressing density
   - reflection/environment quality
   - terrain material detail
2. Clamp high preset DPR more aggressively unless the machine proves it can hold budget.
3. Make recovery slower than degradation to avoid quality oscillation.
4. Track quality state changes in diagnostics.

### Success Gates

- Sustained frame p95 over budget causes visible cost reductions within a few seconds.
- Adaptive changes do not interrupt gameplay or cause large visual popping.
- High-end machines can still climb toward richer settings after stability.

## Priority 3: Move World Dressing Into The Map Prep Pipeline

### Problem

World dressing is already instanced, but it scans heightfield/top surfaces on the client and maintains its own cache. This is a good candidate for shared map-prep work.

### Target Files

- `apps/client/src/components/game/procedural/WorldDressing.tsx`
- `apps/client/src/utils/mapWarmup/mapPrepCache.ts`
- `packages/shared/src/maps/procedural/generator.ts`

### Actions

1. Generate dressing placement data during map prep or in a worker.
2. Store dressing data with the prepared map manifest.
3. Bucket instances spatially so distant dressing can be hidden or reduced.
4. Keep dressing disabled/minimal on competitive and potato tiers.

### Success Gates

- World dressing does no top-surface scan on first render.
- Dressing instance count is budgeted by quality tier.
- Distant dressing can be culled by bucket.

## Priority 3: Clean Up Asset Startup Cost

### Problem

The largest static assets are audio files, especially lobby/game music. This is secondary to world performance, but still affects startup and memory behavior.

### Target Files

- `apps/client/public/sounds/*`
- client audio loading code

### Actions

1. Lazy-load lobby music and match music only when needed.
2. Consider shorter loops or more efficient encodings for large music files.
3. Avoid preloading non-match assets during world warmup.

### Success Gates

- Match startup does not wait on lobby-only assets.
- Audio memory/network cost is visible in asset diagnostics.

## Suggested Implementation Order

1. Add telemetry and fixed seed performance checks.
2. Optimize map semantic repairs and solid-block budget.
3. Add mesh worker backpressure, priority, and actual mesh stats.
4. Split terrain collision from structural colliders.
5. Reduce remote-player and viewmodel draw calls.
6. Extend adaptive quality to model/world complexity.
7. Move dressing generation into map prep.
8. Clean up audio and non-world asset loading.

## Verification Plan

Run these without browser testing:

```bash
pnpm --filter @voxel-strike/physics bench:movement
pnpm --filter @voxel-strike/server bench:room-load
pnpm --filter @voxel-strike/client exec tsx <seed-corpus-map-benchmark>
pnpm --filter @voxel-strike/client exec tsx <mesh-worker-benchmark>
pnpm --filter @voxel-strike/client test
pnpm --filter @voxel-strike/server test
```

Manual browser/gameplay verification remains user-owned per project instruction.

## Open Risks

- Reducing collider fidelity can create movement/projectile parity bugs if not limited carefully around gameplay-critical areas.
- Merging hero/viewmodel meshes can make animation and material effects less flexible.
- Removing or packing mesh attributes may require shader changes and visual comparisons.
- More aggressive adaptive quality needs careful hysteresis so it does not visibly pulse during fights.
- Seed-corpus tests need representative seeds before they become meaningful gates.
