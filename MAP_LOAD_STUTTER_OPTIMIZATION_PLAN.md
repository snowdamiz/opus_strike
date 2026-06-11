# Map Load Stutter Optimization Plan

## Reader And Goal

Reader: an engineer improving first-match smoothness in the React Three Fiber client.

Post-read action: implement a map warmup pipeline so entering `countdown` or `playing` does not pay avoidable first-use CPU or GPU costs on the player-visible frame loop.

## Problem Statement

The first moments after loading into a map can feel choppy, especially on slower devices with maximum graphics. The symptom improves after a short period, which points less to steady-state render cost and more to work that is only paid once per map or once per graphics preset.

The current client already does useful work before releasing gameplay:

- Procedural voxel map generation is deterministic by seed.
- Renderable voxel chunks are grouped into larger regions.
- Region geometry can build through a worker.
- Map readiness waits for all visible region geometry and procedural colliders.
- Some hero effect resources are prewarmed.
- Map vote previews already render candidate maps off-screen before voting starts.

The gap is that "ready" currently means the world data exists. It does not guarantee that the browser and GPU have already completed the expensive first-use rendering path: canvas atlas upload, shader compilation, environment/reflection allocation, shadow map allocation, first material variants, first instanced dressing draw, first viewmodel/effect material draw, and renderer pipeline state creation.

## Working Hypothesis

The stutter is probably a combined first-use spike from:

- Procedural atlas generation and upload, especially high quality maps with color, emissive, roughness, metalness, bump, and ambient occlusion atlases.
- First compile of the patched voxel atlas `MeshStandardMaterial` shader.
- First render of environment/reflection resources at high and ultra quality.
- First shadow-map allocation and first shadow-casting terrain/dressing render.
- First mount and compile of gameplay-only meshes such as flags, effects, speed lines, viewmodel, and hero-specific managers.
- Main-thread follow-up work after worker geometry completes, including `BufferGeometry` creation, attribute uploads, bounding sphere calculation, React commits, and instanced dressing matrix upload.
- Lazy match-world mounting only after leaving pregame, which misses part of the hero-select window as a warmup opportunity.

This also explains why exploring or simply waiting makes the game smoother: once most shaders, textures, buffers, and render paths have been touched, the steady-state workload is lower and more predictable.

## Desired Outcome

- The match loading screen remains visible until the selected map has completed CPU data prep and a bounded GPU warmup pass.
- Player input is enabled only after the warmup gate completes.
- On high and ultra graphics, the first active gameplay seconds should not include large one-time shader, texture, or shadow spikes.
- Warmup should be adaptive: slower devices can spend more loading time up front or temporarily warm at reduced resolution, but should not enter gameplay mid-stutter.
- The implementation should preserve the existing visual quality settings once gameplay starts.

## Plan

### 1. Add A First-Load Measurement Pass

Before changing behavior, extend existing client perf metrics to make the load spike visible.

Track these stages per map seed and graphics profile:

- Match resource preload time.
- Procedural manifest generation time.
- Voxel region batching time.
- Worker mesh build p95 and total count.
- Main-thread geometry materialization time after worker responses.
- Procedural collider load time.
- Voxel atlas generation time by detail level and theme.
- Texture upload and first renderer compile time.
- First shadow/reflection render time.
- Time from selected map seed received to scene warmup complete.
- First five seconds of frame p95 and p99 after the loading screen hides.

The existing perf snapshot already has frame, renderer, voxel, world visual, and system timing fields, so this can be added without a new observability surface.

### 2. Introduce A `MapWarmupCoordinator`

Create a dedicated coordinator for map readiness instead of letting `GameCanvas` infer readiness from terrain alone.

The coordinator should expose a state machine:

- `idle`
- `preparingCpu`
- `preparingGpu`
- `settling`
- `ready`
- `failedWithFallback`

Inputs:

- selected map seed
- current graphics settings
- local hero
- match phase and phase end time
- renderer instance
- generated manifest
- terrain geometry readiness
- collider readiness

Outputs:

- loading progress label/value
- whether `PlayerController` can accept input
- whether gameplay-only objects can become visible
- whether the app can hide `MatchLoadingScreen`

The important behavior change: scene ready should mean "CPU and GPU warmup has finished or deliberately fallen back," not just "all terrain regions exist."

### 3. Start Match World Prep Earlier

Mount or prepare the selected map as soon as the client knows the selected seed, not only after pregame is over.

Use these opportunities:

- During map vote, preserve the selected option's generated manifest and preview work when possible.
- On `mapVoteFinalized`, start selected-map CPU prep immediately while the game room is being created.
- During `hero_select`, keep warming the actual match world behind the hero select UI.
- During `countdown`, finish GPU warmup and settling before accepting input.

The current app treats `waiting` and `hero_select` as pregame and does not mount the match world. That protects UI simplicity, but it gives up a valuable warmup window. The plan is to keep the UI visible while the actual world quietly prepares underneath or in a hidden/offscreen canvas path.

### 4. Reuse Map Vote Work Where It Is Safe

Map vote previews already generate manifests and sync-render preview maps. Reuse the deterministic, seed-based data rather than recomputing everything from scratch for the selected map.

Safe reuse targets:

- generated manifest
- theme lookup
- voxel atlas textures for medium preview if the match quality also uses medium
- region grouping metadata
- maybe worker-initialized manifest data

Do not blindly reuse:

- preview geometry if it was built with different region strategy, quality, or no-physics assumptions
- preview renderer state, because the preview canvas uses its own renderer and low-power settings
- preview materials when selected match graphics require a different material detail

If direct reuse is awkward, still add a selected-seed cache keyed by seed plus map generator version. The cache can be populated both by previews and by match loading.

### 5. Precompute CPU Work Behind The Loading UI

Move these tasks into the warmup coordinator:

- Generate or retrieve the selected map manifest.
- Build renderable region metadata.
- Initialize procedural colliders as soon as physics is available.
- Dispatch all region mesh builds to the worker early.
- Convert worker results into `BufferGeometry` on the main thread under a frame budget.
- Build world dressing instance data under a frame budget.
- Build procedural atlas canvases before the map is visible.

The current progressive reveal avoids a single huge frame, but it still spreads expensive creation into the period right before gameplay. For match start, prefer "progressive warmup while the loading screen is up" over "progressive reveal while the player is trying to move."

### 6. Add A Bounded GPU Warmup Pass

After terrain, dressing, atmosphere, lights, and core gameplay objects are mounted, run explicit GPU warmup before hiding the loading screen.

Warmup steps:

- Force atlas textures to upload through renderer texture initialization or a first hidden render.
- Compile the scene with the active camera using the Three.js renderer compile path.
- Render several frames while the loading screen still covers the canvas.
- Warm the shadow path by rendering once with the active shadow settings.
- Warm the reflection/environment path when reflections are enabled.
- Include representative gameplay-only objects mounted invisibly or at harmless opacity so their shaders compile before first use.

The warmup should be capped. If a device cannot finish within the cap, mark `failedWithFallback`, temporarily lower the most expensive startup-only quality knobs, and continue with a clear metric marker.

### 7. Warm Gameplay-Only Objects Before Input

Currently many objects only mount when `isPlaying && isWorldReady`. That means their first material and shader work can happen at the same moment gameplay starts.

Split "mounted for warmup" from "visible/active":

- Mount flags, viewmodel, speed lines, and effect managers during warmup.
- Keep them hidden, paused, or non-interactive until gameplay is active.
- Prewarm the local hero's viewmodel and common ability materials.
- Prewarm remote player body materials for the maximum expected visible tier.
- Keep expensive effect simulations disabled until active gameplay.

This preserves gameplay behavior while shifting shader and buffer creation out of the first playable frames.

### 8. Make Texture Atlas Generation And Upload Less Spiky

The procedural atlas is a likely high-quality startup hotspot.

Options, in recommended order:

- Cache atlases by theme plus material detail for the lifetime of the tab.
- Add metrics around atlas canvas paint time and texture upload time.
- Pre-generate the selected theme/detail atlas during map vote or hero select.
- Avoid disposing cached atlas textures when only the material wrapper changes.
- Consider prebuilt static atlas images for common themes if canvas painting remains expensive.
- Consider `createImageBitmap` or worker/offscreen canvas generation if browser support and build setup make it straightforward.

Do not start by reducing visual quality globally. First move the work earlier and make it measurable.

### 9. Add A Startup Quality Ramp For Slow Devices

If maximum graphics still exceeds budget on slower devices, use a temporary startup ramp rather than permanently dropping the user's settings.

Possible ramp:

- Warm terrain and core gameplay at the user's selected quality.
- For the first second after reveal, cap nonessential decorative effects.
- Delay decorative dynamic lights, dense atmosphere, and dressing shadows until the frame p95 is stable.
- Bring optional features online over several frames after input is already smooth.

This should be separate from adaptive quality. Adaptive quality changes the user's steady-state settings; startup ramp only changes when expensive optional visuals become active.

### 10. Gate Loading Screen Completion On Warmup

Update `MatchLoadingScreen` progress so it reflects real readiness stages:

- resources
- map
- colliders
- meshes
- textures
- shaders
- shadows/reflections
- gameplay objects
- settling frames

Keep the current synthetic progress only as a smoothing layer. The final 90 to 100 percent should be controlled by the warmup coordinator, not a timer.

### 11. Verification

Do not rely on browser testing in this implementation pass; the project note leaves that to the user. Add non-browser checks where possible:

- Typecheck the client.
- Unit-test pure cache key and warmup state-machine behavior if extracted.
- Add development-only perf logs that can be inspected from the existing performance overlay.

Manual validation for the user:

- Start at maximum graphics on a slow device.
- Load into the same selected seed before and after the change.
- Compare first five seconds frame p95 and p99.
- Confirm input is not enabled before warmup completion.
- Confirm no major visual pop-in appears after the loading screen hides.
- Confirm map vote previews still start the timer once preview rendering completes.

## Implementation Slices

### Slice 1: Instrumentation

Add startup timing marks for atlas generation, worker-to-geometry materialization, collider load, renderer compile, hidden warmup renders, and first five seconds after reveal.

Acceptance criteria:

- The perf snapshot can identify whether a first-load stutter is CPU mesh, texture upload, shader compile, shadow/reflection, or object mount related.
- Existing debug/perf overlay can surface the top startup stage without a new UI.

### Slice 2: CPU Prep Cache

Add a selected-map preparation cache keyed by map seed, generator version, and relevant quality inputs.

Acceptance criteria:

- Selected map manifest and region metadata are generated once per selected seed.
- Map vote or map-finalized code can seed the cache.
- Match loading consumes cached data when available.

### Slice 3: Warmup Coordinator

Replace the single terrain-ready signal with a coordinator-controlled readiness signal.

Acceptance criteria:

- Player input remains disabled until coordinator `ready`.
- Loading screen remains visible until coordinator `ready` or `failedWithFallback`.
- Readiness includes terrain geometry and colliders at minimum.

### Slice 4: GPU Compile And Hidden Render Warmup

Add renderer warmup once the world is mounted behind the loading screen.

Acceptance criteria:

- Voxel material shader is compiled before reveal.
- Active atlas textures are uploaded before reveal.
- Shadow and reflection first-use work happens before reveal when enabled.
- The coordinator records warmup duration and fallback status.

### Slice 5: Gameplay Object Prewarm

Mount representative gameplay objects in a paused/hidden warmup mode before active gameplay.

Acceptance criteria:

- Flags, local viewmodel, common effect materials, and selected hero resources are compiled before reveal.
- Hidden warmup does not spawn real gameplay effects, consume cooldowns, or emit sounds.

### Slice 6: Startup Quality Ramp

If metrics still show first-play spikes, add a one-to-two-second startup ramp for optional visuals.

Acceptance criteria:

- Decorative lights, dense atmosphere, dressing shadows, and nonessential particles can ramp in after the first stable frames.
- User-selected graphics settings remain intact.
- Ramp behavior is visible in metrics and easy to disable for comparison.

## Risks And Mitigations

- Longer loading screen: acceptable if it prevents playable stutter. Show real progress and cap warmup duration.
- Hidden rendering can still cost CPU/GPU: run it while input is blocked and loading UI is visible, with a fallback timeout.
- Double work from map vote previews: reuse only deterministic data and cache by seed/version; avoid cross-renderer GPU assumptions.
- Memory growth from caches: limit caches to recent map seeds and dispose old geometries/textures after match end.
- Warmup mode may accidentally run gameplay side effects: make warmup components explicitly paused and soundless.
- Shader variants may still compile later for rare effects: include representative materials for all heroes at common quality, then expand based on metrics.

## Recommended First Implementation

Start with instrumentation plus the warmup coordinator. Then add the GPU compile/hidden-render gate for the voxel world, because it targets the most likely cause without changing gameplay rules.

After that, add selected-seed CPU caching and gameplay object prewarm. Only add startup quality ramp if measured first-play p95 or p99 remains high after real warmup.
