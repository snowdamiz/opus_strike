# Battle Royale Mode and Map Optimization Plan

## Reader And Outcome

This plan is for an engineer working on Battle Royale rendering and map performance.
After reading it, they should be able to implement a staged optimization roadmap that reduces frame drops from high viewpoints, especially during deployment and other wide-terrain views.

## Problem

Battle Royale uses a much larger map than the standard modes. The current runtime renderer already has terrain LOD, culling, warmup, and coarse geometry, but frame drops still appear when the player sees a lot of terrain from height. The worst case is not just map size. It is the combination of:

- Large visible terrain cone from elevated camera positions.
- Full-detail terrain during deployment/flyover.
- Many terrain regions still mounted or visible from broad views.
- Expensive full-detail geometry hydration when regions switch detail.
- Adaptive quality lowering resolution and effects before it directly reduces BR terrain visibility.

The highest-impact work is to make BR far terrain cheaper structurally, not only to tune graphics presets.

## Current Findings

These numbers came from the existing non-browser benchmark scripts and an additional local high-point visibility estimate.

| Area | Finding |
| --- | --- |
| Large BR world size | 376m x 376m x 96m |
| Renderable terrain regions | 528 |
| Renderable chunks | 4,080 |
| Full-detail terrain | 2,428,136 triangles, about 189 MB geometry data |
| Current coarse terrain | 36,206 triangles, about 2.8 MB geometry data |
| Coarse/full ratio | About 1.5% of full terrain triangles and bytes |
| Full-detail hydration | p95 about 11.4 ms per region, max about 56 ms |
| Coarse hydration | p95 about 0.13 ms per region |
| Runtime balanced high-point estimate | About 265k-281k terrain triangles in view |
| Runtime cinematic high-point estimate | About 430k-464k terrain triangles in view |
| Deployment balanced high-point estimate | About 1.75M-1.79M full-detail terrain triangles in view |

The current coarse LOD is already very effective. The main issue is that deployment disables terrain LOD and uses a very large far plane. That can put most of the island in view as full-detail voxel terrain.

## Optimization Principles

1. Treat deployment and high-altitude views as their own rendering mode.
2. Prefer structural wins over small quality tweaks.
3. Keep gameplay collision and authoritative map data unchanged unless a phase explicitly calls for map generation changes.
4. Make far terrain readable, not detailed.
5. Measure visible triangles, draw calls, visible regions, and detail swaps before and after every change.
6. Keep full voxel detail near players, fights, drops, and interactable POIs.
7. Use fog and cheap far materials to hide LOD transitions.

## Phase 0: Add BR Terrain Diagnostics

Before changing more rendering behavior, add instrumentation that makes the bottleneck visible during normal play.

### Work

- Extend the FPS overlay or create a diagnostics overlay that can show:
  - FPS.
  - Frame p50, p95, and max over a rolling window.
  - Renderer draw calls.
  - Renderer triangles.
  - Renderer geometries and textures.
  - Visible terrain region count.
  - Full-detail region count.
  - Coarse and ultra-coarse region count.
  - Regions hidden by distance.
  - Regions hidden by frustum.
  - Detail swaps per second.
  - Terrain geometry builds and finalizations per second.
- Add a benchmark for high-vantage visibility budgets.
  - Sample the highest playable terrain points.
  - Test multiple look directions.
  - Estimate visible regions and terrain triangles per graphics preset.
  - Include deployment and runtime modes separately.
- Keep the existing map render and hydration benchmarks as guardrails.

### Acceptance Criteria

- A developer can reproduce the high-viewpoint case without opening the browser profiler.
- The overlay can answer whether a drop is caused by terrain triangles, draw calls, geometry swaps, or non-terrain effects.
- CI or local scripts fail if BR terrain visibility budgets regress beyond a defined threshold.

## Phase 1: Fix Deployment/Flyover Visibility

This is the highest-impact phase. Deployment currently behaves like a showcase view: full-detail terrain, very large far plane, and no terrain LOD. That creates the 1.75M+ triangle high-view case.

### Work

- Enable terrain LOD for deployment.
- Replace the deployment full-detail island view with a flyover-specific visibility profile.
- Keep a full-detail bubble around the local player, drop ship, or active deployment camera.
- Use coarse or ultra-coarse terrain for the rest of the visible island.
- Reduce deployment camera far distance by graphics preset.
- Increase deployment fog enough to hide far LOD reduction while preserving route readability.
- Keep dressing, remote movement effects, and terrain impacts tightly capped during deployment.
- Avoid prebuilding all deployment terrain at full detail.

### Starting Values To Test

These are intentionally conservative starting points, not final tuning:

| Preset | Deployment far | Full-detail distance | Coarse distance | Ultra-coarse/far distance |
| --- | ---: | ---: | ---: | ---: |
| Potato | 160 | 36 | 82 | 145 |
| Competitive | 190 | 44 | 104 | 175 |
| Balanced | 230 | 52 | 124 | 215 |
| Cinematic | 285 | 68 | 154 | 270 |

If full-island readability is still required during ship flyover, use a cheap far terrain representation instead of full voxel terrain.

### Acceptance Criteria

- Deployment balanced high-point terrain estimate drops from about 1.75M+ triangles to below 350k terrain triangles.
- Deployment cinematic stays below 600k terrain triangles.
- Deployment no longer prebuilds every region at full detail.
- Drop route readability remains acceptable from the ship and during falling.

## Phase 2: Add Ultra-Far Terrain LOD

The current coarse LOD is an 8-voxel step heightfield-like mesh. It is already only about 1.5% of full-detail terrain, but far terrain can be even cheaper.

### Work

- Add at least one new terrain detail level, such as `ultraCoarse`.
- Generate ultra-coarse terrain from heightfield samples with a larger step, likely 16 or 32 voxels.
- Keep ultra-coarse top surfaces only. Do not emit side-wall detail except where silhouettes need it.
- Use a simple far material with fog-tinted color.
- Prebuild ultra-coarse geometry for all BR regions during warmup.
- Use runtime bands:
  - Full detail near the camera.
  - Coarse for mid terrain.
  - Ultra-coarse for far visible terrain.
  - Culled beyond the final distance.

### Starting Runtime Bands To Test

| Preset | Full | Coarse | Ultra-coarse | Cull |
| --- | ---: | ---: | ---: | ---: |
| Potato | 40 | 78 | 110 | 125 |
| Competitive | 48 | 96 | 135 | 150 |
| Balanced | 54 | 116 | 165 | 185 |
| Cinematic | 72 | 148 | 210 | 235 |

### Acceptance Criteria

- Far terrain triangle count drops by at least 50% compared with the current coarse-only far band.
- Runtime balanced high-point terrain estimate stays below 250k terrain triangles.
- Runtime cinematic high-point terrain estimate stays below 400k terrain triangles.
- No visible popping that harms combat readability.

## Phase 3: Merge Far Terrain Into Macro Meshes

The terrain renderer currently works region by region. Even with low triangles, far views can still carry too many objects and draw calls.

### Work

- Build merged far terrain meshes by map ring or macro tile.
- Keep near terrain as region meshes so detail swaps remain localized.
- Merge only coarse and ultra-coarse geometry.
- Use a small number of far mesh materials.
- Keep macro mesh bounds compatible with frustum culling.
- Avoid merging near full-detail regions, since those need independent visibility and collision relevance.

### Suggested Structure

- Near band: existing region meshes.
- Mid band: existing region meshes or medium macro tiles.
- Far band: large macro meshes, ideally fewer than 16 visible objects.
- Outer/fill terrain: single simple mesh or ring mesh.

### Acceptance Criteria

- Far terrain draw calls are reduced substantially during high-point views.
- Runtime balanced high-point view stays within the draw-call budget even with players and effects active.
- Macro mesh updates do not cause frame hitches during camera movement.

## Phase 4: Screen-Space And Height-Aware LOD

Distance-only LOD is not enough for high viewpoints. A region below the player and far across the terrain should often use lower detail than a same-distance region at eye level.

### Work

- Include camera height in terrain detail selection.
- Include camera pitch and projected region size.
- Add a high-altitude multiplier that shrinks full-detail distance while airborne or above terrain.
- Add hysteresis so detail bands do not flicker.
- Keep nearby combat surfaces in full detail.

### Example Policy

- If camera is more than 20m above local ground, reduce full-detail distance by 20%-35%.
- If camera is more than 40m above local ground, reduce full-detail distance by 40%-55%.
- If a region projects below a small screen-space threshold, force ultra-coarse or cull it.
- If the local player is in deployment/falling state, favor far readability over surface detail.

### Acceptance Criteria

- High-ground views select fewer full-detail regions than ground-level views.
- Detail transitions remain stable while moving and looking around.
- Terrain underfoot and near combat stays full detail.

## Phase 5: Heightfield Horizon/Occlusion Culling

High terrain can see a broad frustum, but not every far region contributes useful pixels. Near ridges, structures, and boundary walls can hide far terrain. A simple heightfield horizon pass can reject regions that are technically in the frustum but visually blocked.

### Work

- Build a low-resolution heightfield visibility helper for BR maps.
- Divide camera view into angular bins.
- For each bin, track the highest visible terrain slope encountered.
- Reject far region bounds that fall below the current horizon in that bin.
- Run this only for BR runtime and deployment views.
- Update at a lower frequency than every frame, with camera movement thresholds.

### Acceptance Criteria

- High-point views hide far terrain behind nearer terrain features.
- Culling CPU cost remains well below 1 ms in typical frames.
- No obvious holes appear in visible terrain.

## Phase 6: Make Far Terrain Materials Cheaper

Current full-detail terrain uses texture array sampling and lighting. Far terrain should not pay that cost.

### Work

- Use an unlit far material for coarse and ultra-coarse terrain.
- Reduce or remove emissive and Lambert lighting for far terrain.
- Use fog-tinted vertex or uniform colors.
- Consider a tiny custom shader for far terrain that supports only color, fog blend, and optional height tint.
- Disable shadow casting and receiving on far terrain.
- Keep textured material only for full-detail near terrain.

### Acceptance Criteria

- Far terrain shader cost is lower in GPU profiles.
- Visual difference is mostly hidden by distance and fog.
- Material count does not grow significantly.

## Phase 7: BR-Specific Adaptive Quality

The current adaptive quality path lowers reflections, environment, materials, shadows, and resolution before it changes the graphics preset. In a terrain-bound BR drop, that may not reduce the actual cause quickly enough.

### Work

- Add a BR terrain pressure state derived from frame p95 and renderer triangle/draw-call counters.
- If terrain pressure remains high, scale BR visibility directly:
  - Lower full-detail distance.
  - Lower coarse distance.
  - Lower camera far.
  - Increase fog density slightly.
  - Reduce dressing and terrain impact distances.
- Recover slowly when performance stabilizes.
- Make the scaling independent of permanent user graphics settings.

### Acceptance Criteria

- A player on balanced settings can recover from terrain-bound drops without waiting for all non-terrain quality settings to step down.
- Adaptive BR visibility changes are temporary and reversible.
- User-selected graphics preset remains intact.

## Phase 8: Longer-Term BR Terrain Renderer

The largest structural improvement is to stop using voxel-region meshes for the entire BR terrain surface. Keep voxels where gameplay needs them, and render broad terrain as a purpose-built heightfield.

### Work

- Split BR terrain rendering into:
  - Heightfield terrain surface.
  - Voxel structures and cover.
  - Boundary/outer fill.
  - Collision data, unchanged from gameplay perspective.
- Generate a terrain mesh directly from the BR heightfield.
- Use chunked heightfield tiles with LOD.
- Keep full voxel meshes for destructible or tactical structures if needed.
- Preserve the existing map manifest as the source of truth.

### Acceptance Criteria

- Large BR terrain no longer creates millions of full-detail voxel triangles.
- Full map terrain can be visible from deployment without full voxel rendering.
- Gameplay collision and movement behavior remain unchanged.

## Map Generation Opportunities

Rendering fixes should come first, but map generation can reduce worst cases too.

### Work

- Reduce unnecessary vertical side surfaces on terrain shells where they are never visible.
- Keep tall POI silhouettes, but simplify their far rendering.
- Ensure very high terrain features have enough occluders and fog-friendly silhouettes.
- Avoid large flat high platforms that expose the entire map without natural occlusion.
- Consider smaller default BR size for lower player-count lobbies.

### Acceptance Criteria

- Map remains readable and fun for BR pacing.
- Sightline constraints remain valid.
- Rendering budgets improve without making the island feel empty.

## Benchmark And Verification Plan

Use these checks after each phase:

1. BR map render budget benchmark.
2. BR geometry hydration benchmark.
3. New high-point visibility benchmark.
4. Local diagnostics overlay in a real match.
5. Manual gameplay pass by the user for visual quality and combat readability.

Track these metrics:

| Metric | Target |
| --- | --- |
| Deployment balanced terrain triangles | Less than 350k |
| Deployment cinematic terrain triangles | Less than 600k |
| Runtime balanced high-point terrain triangles | Less than 250k |
| Runtime cinematic high-point terrain triangles | Less than 400k |
| Full-detail hydration p95 | No worse than current baseline |
| Coarse/ultra-coarse hydration p95 | Less than 1 ms |
| Terrain detail swaps | No sustained bursts during normal camera movement |
| Far terrain draw calls | Substantially lower after macro mesh phase |

## Recommended Implementation Order

1. Add diagnostics and the high-point visibility benchmark.
2. Enable deployment LOD and remove full-detail deployment rendering.
3. Add ultra-far terrain LOD.
4. Merge far terrain into macro meshes.
5. Add height-aware and screen-space LOD.
6. Add horizon/heightfield occlusion culling.
7. Make BR adaptive quality scale terrain visibility directly.
8. Evaluate the longer-term heightfield terrain renderer.

## Risks

- Too much fog or far simplification can hurt navigation during drop.
- Aggressive LOD can cause popping while falling quickly.
- Macro meshes can reduce draw calls but make culling less granular if tile sizes are too large.
- Heightfield occlusion needs conservative tuning to avoid terrain holes.
- Adaptive visibility must not feel like random graphics changes during combat.

## Open Questions

- How much full-island readability is required during the drop ship phase?
- Should cinematic prioritize visuals, or should it still obey strict 60 FPS terrain budgets?
- Are BR terrain frame drops more common in deployment, runtime hilltops, or spectator camera?
- Should low player-count BR lobbies default to medium or small maps?
- Which target hardware should define the balanced preset budget?

## Summary

The biggest immediate win is to stop rendering deployment as full-detail terrain with a 1000m far plane. The current coarse terrain path is already strong, so the roadmap should build on it: add ultra-far LOD, merge far meshes, make LOD height-aware, and add terrain-specific adaptive quality. Longer term, BR should render broad terrain from the heightfield and reserve voxel-region meshes for nearby gameplay detail and structures.
