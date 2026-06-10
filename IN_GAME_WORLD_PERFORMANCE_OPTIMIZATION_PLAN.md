# In-Game World Performance Optimization Plan

Date: 2026-06-10

Goal: make the in-game world feel buttery smooth on high-end machines and remain playable on very weak hardware. The target outcome is a real "potato mode" that favors stable frame pacing over visual richness, plus scalable systems that can climb back up on better GPUs.

Browser testing was intentionally not performed for this audit, per the project instruction in `AGENTS.md`.

## Executive Summary

The codebase already has several strong performance foundations:

- Voxel terrain uses greedy meshing and batches chunks into region meshes.
- Voxel surfaces use a texture atlas instead of many individual material textures.
- Several projectile/effect systems already use object pools and instanced meshes, especially Blaze rockets.
- Remote players already have distance-based LOD.
- A dynamic light budget and adaptive quality controller already exist.
- Client perf instrumentation exists for frame samples, system samples, voxel generation, physics queries, effects, projectiles, and lights.

The largest improvement opportunity is that the lowest visual path is not actually a potato path yet. Low settings still allow shadows, reflections, world dressing, atmosphere particles, expensive voxel texture generation, multiple dynamic effects, and heavy React/Three subtrees in a number of places.

The best path is to add a true minimum-spec profile, then make every expensive in-world subsystem honor it consistently. After that, move synchronous world-generation work off the main thread and convert the remaining per-effect React object churn into pooled, instanced, or shader-driven systems.

## Proposed Performance Budgets

These are starting budgets. They should be tuned against real hardware once profiling is run.

### Potato Mode

- Frame target: stable 60 FPS when possible, graceful degradation before frame time exceeds 22 ms.
- CPU frame p95: <= 12 ms.
- GPU frame p95: <= 10 ms.
- Device pixel ratio: 0.6 to 0.9.
- Antialiasing: off.
- Shadows: off.
- Reflections: off.
- Dynamic lights: 0 to 1 active effect lights.
- Static accent lights: off.
- Atmosphere: off, or <= 50 very cheap particles.
- World dressing: off, or <= 100 total instances.
- Full remote voxel bodies: max 1 to 2 nearest players.
- Draw calls: <= 250 to 350 during combat.
- Visible triangles: <= 150k to 250k during combat.
- Active non-critical effects: aggressively capped and distance culled.

### Balanced Mode

- Frame target: stable 60 FPS, ideally 90 FPS on mid-range hardware.
- CPU frame p95: <= 10 ms.
- GPU frame p95: <= 12 ms.
- Shadows: low or medium, capped to one shadow caster.
- Dynamic lights: <= 4 budgeted lights.
- Reflections: low resolution or disabled during combat stress.
- Effects: capped but visually recognizable.

### Cinematic Mode

- Frame target: stable 60 FPS on strong machines.
- Dynamic lights, reflections, shadows, dressing, and atmosphere can scale up.
- Cinematic should never change gameplay timing or physics behavior.

## High-Impact Findings

### 1. There Is No True Potato Graphics Preset

Relevant files:

- `apps/client/src/store/settingsStore.ts`
- `apps/client/src/components/game/visualQuality.ts`
- `apps/client/src/components/game/GameCanvas.tsx`

Current presets are `competitive`, `balanced`, and `cinematic`. `competitive` is helpful, but it still maps to a fairly rich world:

- Resolution scale is `medium`, not a minimum-spec scale.
- Shadow quality is `low`, but low shadows are still enabled.
- Environment quality is `low`, but low still allows atmosphere and dressing.
- Dynamic light budget remains nonzero.
- Some expensive systems mount regardless of quality and decide later how much work to do.

Recommended change:

- Add a `potato` or `minimum` graphics preset.
- Make `competitive` about input clarity and stable visuals.
- Make `potato` about survival on weak hardware.
- Let adaptive quality degrade into `potato` behavior during sustained frame drops.

Potato profile should set:

- `resolutionScale: "low"` or a new `"minimum"` value.
- `antialiasing: false`.
- `shadowQuality: "off"`.
- `reflectionQuality: "off"`.
- `environmentQuality: "off"` or `"minimum"`.
- `materialQuality: "low"`.
- `effectsQuality: "low"` or `"minimum"`.
- `dynamicLightBudget: 0` or `1`.
- `staticAccentLights: false`.

### 2. Low Quality Still Pays for Expensive Voxel Texture Work

Relevant files:

- `apps/client/src/components/game/procedural/textureAtlas.ts`
- `apps/client/src/components/game/procedural/materials.ts`

The atlas generator creates six `CanvasTexture` layers:

- color
- bump
- roughness
- metalness
- emissive
- ambient occlusion

Even when material detail is low, `useVoxelMaterial` calls `createVoxelAtlasTextures(theme)` first. That means low quality still generates unused atlas maps and pays for large canvas work.

Recommended change:

- Make atlas creation detail-aware.
- Potato/low should generate only the maps it actually binds.
- Prefer a small pre-baked atlas for potato mode.
- Use smaller tile sizes for low quality, such as 64 px instead of 128 px.
- Lower anisotropy in potato mode to 1 or 2.
- Avoid bump, metalness, roughness, and AO maps in potato mode.

Expected impact:

- Faster first match load.
- Lower memory pressure.
- Less texture upload work.
- Simpler voxel shader path on weak GPUs.

### 3. Voxel Meshing Is Good Architecturally, But Hot Loops Allocate Too Much

Relevant files:

- `apps/client/src/components/game/procedural/VoxelMap.tsx`
- `apps/client/src/components/game/procedural/VoxelChunkMesh.tsx`
- `apps/client/src/components/game/procedural/meshBuilder.ts`
- `packages/shared/src/maps/procedural/ctfLayout.ts`

The current terrain mesh path has good high-level choices:

- Greedy meshing.
- Chunk-to-region batching.
- Geometry caching.
- One material for voxel terrain.

The hot path can still be made much cheaper:

- `MeshBuffers` uses JavaScript `number[]` arrays before creating typed buffer attributes.
- Greedy masks are allocated repeatedly per slice.
- The block accessor does floor math, object construction, and map lookup inside very hot loops.
- Region geometry can be generated synchronously on the main thread.

Recommended change:

- Use pooled typed arrays or capacity-managed typed builders for mesh buffers.
- Reuse greedy mask arrays per worker/build task.
- Replace hot `Map` lookup plus object construction with precomputed chunk lookup tables.
- Build region geometry in a Web Worker and transfer typed arrays back to the main thread.
- Progressive-load region meshes during a loading phase instead of doing all heavy work in one burst.
- Keep region batching, but add a stricter potato cap for visible/generated terrain detail.

Expected impact:

- Fewer main-thread hitches during world creation.
- Less garbage collection pressure.
- More predictable frame pacing after map changes.

### 4. Procedural Map Scale Is Ambitious for Minimum-Spec Hardware

Relevant files:

- `packages/shared/src/maps/procedural/ctfLayout.ts`
- `packages/shared/src/maps/procedural/construction.ts`
- `packages/shared/src/maps/procedural/colliders.ts`

The procedural world size and voxel size create a large voxel field. Greedy meshing makes this renderable, but the generation, scan, collider, and mesh-build work still has to happen somewhere.

Recommended change:

- Add a min-spec terrain profile that can use coarser non-gameplay visual detail while preserving gameplay collision.
- Keep authoritative gameplay dimensions stable.
- Consider a visual-only coarse mesh for distant/static terrain on potato mode.
- Add explicit budgets to the map manifest:
  - max render chunks
  - max generated region meshes per frame
  - max collider count
  - max dressing spawn points
  - estimated triangles per quality profile

Expected impact:

- More control over worst-case maps.
- Easier regression detection when new maps become too expensive.

### 5. Collider Loading and Physics Queries Can Hitch

Relevant files:

- `apps/client/src/hooks/usePhysics.ts`
- `apps/client/src/physics/temporaryWallColliders.ts`
- `packages/shared/src/maps/procedural/colliders.ts`

Current strengths:

- Procedural colliders are merged into cuboids.
- Ground checks have a heightfield fast path.
- Client perf metrics track physics query counts and times.

Current risks:

- Procedural collider loading creates many Rapier colliders in a synchronous loop.
- Collider signatures are computed by iterating through all colliders.
- Some raycast paths do a cast to find a hit and then another cast to retrieve normals.
- Temporary wall colliders call `updateSceneQueries()` per segment.
- Combat systems can issue many per-frame raycasts for projectiles, targeting, hookshots, movement, and indicators.

Recommended change:

- Store a precomputed collider signature in the map manifest.
- Load colliders progressively while a loading screen is visible.
- Batch temporary wall segment insertion and call `updateSceneQueries()` once.
- Use one `castRayAndGetNormal` call when normals are required.
- Keep cheaper no-normal raycasts for projectiles that only need hit distance.
- Add a per-frame physics query budget for visual-only systems.
- Throttle targeting indicators and cache results across nearby frames.
- Keep gameplay-critical movement queries highest priority.

Expected impact:

- Fewer frame spikes when maps or temporary walls load.
- Less physics work during combat peaks.

### 6. Effects Are Partly Optimized, But Not Uniformly

Relevant files:

- `apps/client/src/components/game/effects/effectResources.ts`
- `apps/client/src/components/game/effects/Effects.tsx`
- `apps/client/src/components/game/effects/TerrainImpactEffects.tsx`
- `apps/client/src/components/game/blaze/rockets.tsx`
- `apps/client/src/components/game/effects/HookshotEffects.tsx`
- `apps/client/src/components/game/effects/SlideSpeedLines.tsx`
- `apps/client/src/components/game/effects/useEffectLOD.ts`

Current strengths:

- Shared effect resources exist.
- Blaze rockets use a strong pooled, instanced architecture.
- Phantom blink effects are pooled.
- Terrain impact has a pooled path for phantom dire impacts.

Current risks:

- Some effects still create per-effect React subtrees, meshes, materials, or lights.
- `TerrainImpactBurst` includes an unbudgeted point light.
- `Effects.tsx` filters arrays during cleanup and has old mesh-per-effect patterns.
- Grapple lines rebuild geometry with `setFromPoints`.
- Slide speed lines render many individual meshes and update each per frame.
- `useEffectLOD` appears stale or unused and relies on camera position dependencies that will not update naturally through React.

Recommended change:

- Make Blaze rockets the template for all high-frequency combat visuals.
- Convert terrain impact bursts to pooled instanced meshes or points.
- Replace all effect point lights with `BudgetedPointLight` or remove them in potato mode.
- Convert grapple/hookshot/swing lines to pooled buffer geometry with direct attribute updates.
- Convert slide speed lines to one instanced mesh or one shader-driven particle/ribbon pass.
- Replace `useEffectLOD` with a central frame-updated LOD service, or fix it and wire it into every effect manager.
- Add hard caps by quality:
  - max active impacts
  - max active trails
  - max active particles
  - max active effect lights
  - max visible remote ability effects

Expected impact:

- Much lower draw-call count during fights.
- Less React reconciliation during combat.
- Better worst-case frame pacing.

### 7. Atmosphere and Dressing Need a Hard Off Switch

Relevant files:

- `apps/client/src/components/game/world/WorldAtmosphere.tsx`
- `apps/client/src/components/game/procedural/WorldDressing.tsx`
- `apps/client/src/components/game/visualQuality.ts`

Atmosphere particles and world dressing make the world feel alive, but they are optional for gameplay.

Current risks:

- Low environment quality still has minimum particle counts.
- Atmosphere updates CPU-side buffer positions at 30 Hz.
- Some particle systems disable frustum culling.
- World dressing scans voxel blocks to find placement surfaces.
- Dressing uses multiple instanced meshes, which is good, but still costs CPU, memory, shadows, and draw calls.

Recommended change:

- Potato mode should disable atmosphere and dressing by default.
- Low mode should use very small counts and no shadows.
- Generate dressing spawn points from the procedural heightfield instead of scanning all voxel blocks.
- Move atmosphere animation into shaders where practical.
- Keep CPU-updated particles only for higher quality modes.
- Enable culling where possible with correct bounds instead of `frustumCulled={false}`.

Expected impact:

- Reduced CPU work.
- Reduced vertex buffer updates.
- Lower draw calls and material work.

### 8. Remote Player Rendering Has LOD, But Full Bodies Are Expensive

Relevant files:

- `apps/client/src/components/game/OtherPlayers.tsx`
- `apps/client/src/components/game/heroes/HeroVoxelBody.tsx`

Current strengths:

- Remote players already switch between full voxel body, simplified body, and marker.
- LOD updates are throttled.

Current risks:

- Full `HeroVoxelBody` renders many individual meshes.
- Each full body creates multiple material instances.
- Animation work updates many transforms every frame.
- Distant markers and beacons still have animated meshes.
- Nameplates create per-player canvas textures.

Recommended change:

- Cap full remote voxel bodies by quality and distance.
- Potato mode should usually render remotes as simplified bodies or markers.
- Share remote body geometries and material variants across players.
- Reduce animation tick rate for non-near remotes.
- Use instanced simplified remote bodies for common parts.
- Disable or simplify visibility beacons and nameplate updates on potato mode.
- Keep the local player/viewmodel visually clear, then spend remaining budget on nearby threats.

Expected impact:

- Lower draw calls in team fights.
- Lower material count.
- Less per-frame transform work.

### 9. Hero Viewmodel Systems Need Consolidation

Relevant file:

- `apps/client/src/components/game/heroes/HeroViewmodel.tsx`

The hero viewmodel is large and contains many separate frame loops. It is important visually because it anchors player feedback, but it should have quality tiers too.

Recommended change:

- Consolidate viewmodel `useFrame` loops where possible.
- Mount only the active hero's expensive viewmodel systems.
- Add viewmodel effect quality tiers:
  - potato: core weapon/hand motion only
  - balanced: core effects and modest trails
  - cinematic: full flourish
- Avoid per-frame material updates unless the value actually changes enough to matter.
- Prewarm only resources that are likely to be needed in the current match.

Expected impact:

- Lower baseline CPU cost for every frame.
- Less hidden cost from inactive hero-specific visuals.

### 10. Lighting and Shadows Need Stricter Quality Gates

Relevant files:

- `apps/client/src/components/game/GameCanvas.tsx`
- `apps/client/src/components/game/visualQuality.ts`
- `apps/client/src/components/game/systems/DynamicLightBudget.tsx`
- `apps/client/src/components/game/effects/TerrainImpactEffects.tsx`

Current strengths:

- A dynamic light budget system exists.
- Quality config already controls shadow map size and light count.

Current risks:

- Low shadow quality still enables shadows.
- GameCanvas mounts multiple static lights.
- Some effect lights bypass the dynamic light budget.
- Reflection environment can still run in modes that should be purely performance-focused.

Recommended change:

- Potato mode: no shadows, no reflections, no static accent lights.
- Low mode: shadows off by default unless the user explicitly enables them.
- Every effect light must go through `BudgetedPointLight`.
- Add a runtime emergency mode that disables all nonessential dynamic lights after sustained frame drops.
- Reduce shadow map size and update frequency before reducing resolution when the bottleneck is GPU lighting.

Expected impact:

- Large GPU savings on weak integrated GPUs.
- More consistent combat performance.

### 11. Canvas Remounting Can Cause Quality-Change Hitches

Relevant file:

- `apps/client/src/components/game/GameCanvas.tsx`

The `Canvas` key includes resolution scale and antialiasing. This can remount the whole render tree when those settings change.

Recommended change:

- Avoid full canvas remount for resolution scale changes.
- Apply pixel ratio changes through renderer APIs where possible.
- Treat antialiasing changes as a setting that may require a controlled restart or loading-screen transition.
- Ensure adaptive quality never triggers full world remounts during gameplay.

Expected impact:

- Fewer severe hitches during adaptive quality changes.
- Cleaner transition between quality tiers.

### 12. Audio Preloading Can Compete With Match Startup

Relevant files:

- `apps/client/src/hooks/useAudio.ts`
- `apps/client/public/sounds`

The public sound folder is sizable, and some music assets are large. `preloadSounds` uses broad concurrent loading and decoding.

Recommended change:

- Stream music using media elements instead of decoding full tracks into `AudioBuffer`.
- Limit concurrent audio decode jobs.
- Preload common combat sounds first.
- Load hero-specific sounds only for the local hero and nearby enemy heroes.
- Compress large music and ambience files more aggressively.
- Defer noncritical UI/lobby sounds outside match startup.

Expected impact:

- Faster match entry.
- Less memory pressure.
- Fewer startup stalls on weak CPUs.

## Phased Implementation Plan

### Phase 0: Baseline and Budgets

Purpose: make optimization measurable.

Tasks:

- Add explicit perf budgets to a client-facing config module.
- Extend perf snapshots with:
  - renderer draw calls
  - triangles
  - texture count
  - geometry count
  - material count
  - active atmosphere particles
  - active world dressing instances
  - active full remote bodies
- Add debug labels for major frame systems.
- Create a repeatable local "combat stress" scenario that can run without manual matchmaking.
- Record baseline snapshots for potato, competitive, balanced, and cinematic.

Acceptance criteria:

- A developer can see which subsystem exceeded budget.
- A perf snapshot can explain a slow frame without guesswork.
- Browser-based validation remains manual, per project instruction.

### Phase 1: True Potato Mode

Purpose: create a reliable minimum-spec floor quickly.

Tasks:

- Add a `potato` graphics preset.
- Add `shadowQuality: "off"` if needed.
- Add `environmentQuality: "off"` or make existing off mode first-class in presets.
- Add a lower resolution scale tier, such as 0.6 to 0.85 DPR.
- Disable antialiasing, shadows, reflections, static accent lights, and world dressing in potato.
- Set dynamic light budget to 0 or 1.
- Disable atmosphere or reduce it to one very cheap shader/points pass.
- Cap full remote voxel bodies to 1 or 2.
- Lower effect caps globally.
- Make adaptive quality able to enter potato-like emergency behavior during sustained drops.

Acceptance criteria:

- Potato mode visibly changes all major expensive systems.
- Low-end settings do not silently create high-end resources.
- Switching into adaptive emergency mode does not remount the full world.

### Phase 2: Texture and Material Simplification

Purpose: reduce startup, upload, and shader cost.

Tasks:

- Make `createVoxelAtlasTextures` accept a material detail or quality profile.
- Generate only needed maps for the active profile.
- Add a 64 px tile atlas for potato mode.
- Remove bump, AO, roughness, and metalness maps from potato mode.
- Use a simplified voxel material for potato mode.
- Pre-bake generated atlases into static assets if visual iteration stabilizes.
- Lower anisotropy on low-end profiles.

Acceptance criteria:

- Potato mode creates and uploads fewer textures.
- Low material mode does not generate unused canvas layers.
- Voxel shader path is materially cheaper on weak GPUs.

### Phase 3: Voxel Generation and Mesh Build Optimization

Purpose: eliminate world-generation hitches and reduce garbage.

Tasks:

- Move procedural mesh building to a Web Worker.
- Transfer typed arrays back to the render thread.
- Replace `number[]` mesh buffers with pooled typed builders.
- Reuse greedy masks.
- Replace hot block accessor map/object work with precomputed lookup tables.
- Generate region meshes progressively during loading.
- Add per-frame region build budgets for dynamic rebuilds.
- Add map manifest estimates for chunks, triangles, colliders, and dressing.

Acceptance criteria:

- Starting a match no longer blocks the main thread for large terrain builds.
- Mesh generation creates meaningfully less garbage.
- Worst-case map generation is bounded by explicit budgets.

### Phase 4: Physics Query and Collider Optimization

Purpose: make combat and map loading less spiky.

Tasks:

- Precompute and store collider signatures in manifests.
- Load procedural colliders in batches during loading.
- Batch temporary wall collider insertion and call `updateSceneQueries()` once.
- Replace double raycasts with single normal-aware queries where normals are needed.
- Add a priority queue or budget for visual-only physics queries.
- Throttle target indicators and noncritical raycasts.
- Keep movement and hit detection queries highest priority.
- Add query counters by feature, not only global totals.

Acceptance criteria:

- Collider loading has bounded frame cost.
- Visual-only systems cannot starve gameplay-critical physics.
- Physics metrics identify the highest query producers.

### Phase 5: Combat Effects Rewrite Around Pools

Purpose: lower combat draw calls and React churn.

Tasks:

- Use Blaze rockets as the reference architecture.
- Convert terrain impact effects to pooled instanced meshes or points.
- Convert hookshot ropes, grapple lines, and swing lines to pooled buffer geometry.
- Convert slide speed lines to one instanced or shader-driven system.
- Replace per-effect material creation with shared resource lookups.
- Ensure every effect light is budgeted.
- Implement distance and quality caps for all effects.
- Remove or retire unused duplicate effect implementations.

Acceptance criteria:

- Combat effect count can spike without proportional React subtree creation.
- Draw calls stay within budget during ability-heavy fights.
- Potato mode keeps gameplay-readable effects while dropping decoration.

### Phase 6: Atmosphere, Dressing, and World Decoration

Purpose: make non-gameplay visuals scale cleanly.

Tasks:

- Add a hard off path for atmosphere and dressing.
- Use shader animation for atmosphere particles where practical.
- Generate dressing placement from procedural heightfield data.
- Add quality-scaled spawn counts and distance culling.
- Disable dressing shadows except in cinematic mode.
- Use shared low-cost materials for low-end decoration.

Acceptance criteria:

- Potato mode spends almost no CPU/GPU time on decoration.
- Balanced mode retains world feel without large CPU buffer updates.
- Cinematic mode remains visually rich without affecting lower profiles.

### Phase 7: Remote Player and Viewmodel LOD

Purpose: reduce team-fight cost without hurting readability.

Tasks:

- Cap full remote voxel bodies by quality.
- Share materials and geometry across remote players.
- Add instanced simplified remote bodies.
- Lower animation update frequency for distant remotes.
- Simplify or disable remote beacons in potato mode.
- Reduce nameplate update frequency and texture churn.
- Consolidate viewmodel frame loops.
- Add viewmodel effect quality tiers.

Acceptance criteria:

- Team fights do not scale linearly with expensive full-body render cost.
- Nearby opponents remain readable.
- Local viewmodel stays responsive.

### Phase 8: Asset and Audio Startup Optimization

Purpose: reduce load time and memory pressure.

Tasks:

- Stream long music tracks instead of decoding them into audio buffers.
- Cap concurrent sound decoding.
- Compress large audio assets.
- Preload only local hero and common combat sounds at match start.
- Defer noncritical sounds.
- Convert large static images to modern compressed formats where supported.
- Ensure generated assets have build-time cache keys.

Acceptance criteria:

- Match startup is not blocked by broad audio decoding.
- Memory use is lower during first combat.
- Asset loading priority matches gameplay need.

## Suggested Implementation Order

1. Add the true potato preset and make all existing quality configs honor it.
2. Turn off low-end shadows, reflections, static accent lights, atmosphere, and dressing.
3. Make voxel atlas generation quality-aware.
4. Budget all dynamic effect lights.
5. Replace or fix effect LOD and wire it into all effect managers.
6. Move voxel mesh generation to worker-backed typed buffers.
7. Batch collider loading and temporary wall scene-query updates.
8. Convert terrain impacts, slide lines, and hookshot visuals to pooled instanced systems.
9. Add stricter remote player and viewmodel LOD.
10. Optimize audio and static asset startup.

## Quick Wins

These are the lowest-risk changes likely to produce fast gains:

- Add `potato` preset.
- Make low shadows truly off.
- Disable reflections in all performance-focused presets.
- Set dynamic light budget to 0 or 1 in potato mode.
- Replace `TerrainImpactBurst` point lights with budgeted lights.
- Disable atmosphere and dressing in potato mode.
- Stop generating unused voxel atlas maps in low material mode.
- Lower low-end atlas tile size.
- Reduce or disable slide speed lines in potato mode.
- Batch temporary wall `updateSceneQueries()` calls.
- Stream music instead of decoding full tracks.

## Medium-Risk, High-Reward Work

- Worker-backed voxel mesh generation.
- Typed array mesh builders.
- Central effect pool registry.
- Instanced remote simplified bodies.
- Shader-driven atmosphere.
- Quality-aware viewmodel effect tiers.
- Per-frame physics query budgeting.

## Long-Term Direction

The long-term ideal is a world renderer that treats every expensive visual as budgeted:

- Terrain meshes are generated off-thread and loaded progressively.
- World decorations are optional and data-driven.
- Effects are pooled by default.
- Lights are always budgeted.
- Full character rigs are reserved for the local player and nearest important remotes.
- Physics queries are prioritized by gameplay importance.
- Adaptive quality changes cheap features first and never causes a world remount during combat.

That direction should make the game scale from "runs on a potato" to "looks excellent on a strong GPU" without maintaining two separate games.

## Tracking Checklist

- [ ] Add potato/minimum preset.
- [ ] Add explicit world performance budgets.
- [ ] Extend perf snapshot with renderer and world counts.
- [ ] Make low shadows truly off.
- [ ] Disable reflection path for performance presets.
- [ ] Make atlas generation quality-aware.
- [ ] Add small low-end voxel atlas path.
- [ ] Simplify potato voxel material.
- [ ] Workerize voxel mesh generation.
- [ ] Replace mesh builder `number[]` buffers with typed builders.
- [ ] Reuse greedy meshing masks.
- [ ] Precompute faster chunk lookup for mesh building.
- [ ] Progressive-load region meshes.
- [ ] Batch procedural collider loading.
- [ ] Batch temporary wall query updates.
- [ ] Reduce duplicate raycasts where normals are needed.
- [ ] Add visual physics query budgets.
- [ ] Convert terrain impacts to pooled instanced effects.
- [ ] Convert hookshot and grapple lines to pooled buffers.
- [ ] Convert slide speed lines to one instanced/shader system.
- [ ] Budget every effect light.
- [ ] Add hard-off atmosphere path.
- [ ] Generate dressing placement from heightfield data.
- [ ] Add stricter remote player LOD caps.
- [ ] Share remote player materials and geometry.
- [ ] Consolidate viewmodel frame loops.
- [ ] Add viewmodel quality tiers.
- [ ] Stream music assets.
- [ ] Limit audio decode concurrency.
- [ ] Add repeatable stress scenario for profiling.

