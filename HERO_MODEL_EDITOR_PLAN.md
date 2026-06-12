# Hero Model Editor Plan

## Purpose

Build a purpose-built 3D editor for Opus Strike hero visuals, available only in development at `/editor`. The editor should let us adjust and create visual models for existing heroes across both:

- Full-body third-person hero models.
- First-person viewmodels.

The editor should work with the game's current procedural voxel style instead of introducing a generic DCC workflow. It should make the existing model code easier to maintain, easier to edit, and harder to accidentally desync from gameplay sockets.

## Current Architecture Review

The client is a Vite + React + React Three Fiber app. There is no routing library; [App.tsx](apps/client/src/App.tsx) switches screens based on app/game phase.

Hero visuals are procedural TypeScript, not imported GLB/FBX assets:

- Full-body models live mostly in [HeroVoxelBody.tsx](apps/client/src/components/game/HeroVoxelBody.tsx).
- First-person models live mostly in [HeroViewmodel.tsx](apps/client/src/components/game/HeroViewmodel.tsx).
- Full-body model previews already exist in [HeroPreviewCanvas.tsx](apps/client/src/components/ui/HeroPreviewCanvas.tsx).
- Gameplay socket names and fallback offsets live in [physics.ts](packages/shared/src/constants/physics.ts).
- First-person sockets are registered through [viewmodelSocketRegistry.ts](apps/client/src/viewmodel/viewmodelSocketRegistry.ts).
- Remote/full-body sockets are registered through [remoteModelSocketRegistry.ts](apps/client/src/viewmodel/remoteModelSocketRegistry.ts).

Important implication: the editor should not just move visual meshes. It must expose and validate sockets, because projectiles, ropes, beams, cast origins, and observed ability effects depend on them.

## Goals

- Add a dev-only `/editor` route.
- Standardize hero model definitions before building the editor UI.
- Edit full-body model parts with stable IDs, transforms, materials, bones, and sockets.
- Edit first-person viewmodel parts with stable IDs, transforms, sockets, and preview poses.
- Build new hero visual models from useful body, weapon, hand, socket, and archetype presets.
- Author and tune hero animations with reusable locomotion, attack, ability, and first-person pose presets.
- Support cloning existing hero visuals and animations into new visual model variants.
- Provide import/export and dev-only save workflows that make a future hero implementation easier to wire into code.
- Make editor output source-controlled and reviewable.
- Include clear scene guides for camera, scale, body bounds, and gameplay sockets.

## Non-Goals

- Do not fully implement new gameplay heroes in this milestone. New gameplay heroes touch `HeroId`, shared constants, server ability handling, UI, game logic, and balance.
- Do generate a new-hero implementation package that gives developers model files, animation files, socket manifests, suggested constants, and a checklist of code touchpoints.
- Do not introduce a binary asset pipeline unless the team later decides to support GLB/FBX.
- Do not make the editor accessible, bundled, or served in production.
- Do not replace existing game previews or lobby rendering in this pass.

## Production Lockdown Requirements

The editor must be impossible to access in production through multiple layers:

1. Frontend route gate:
   - In [App.tsx](apps/client/src/App.tsx), check `config.isDev && window.location.pathname === '/editor'`.
   - Only lazy-load the editor component from inside that dev-only branch.
   - Do not statically import editor files from production-reachable modules.

2. Production bundle exclusion:
   - Use `import.meta.env.DEV`/`config.isDev` so Vite can dead-code-eliminate the editor branch in production.
   - Add a build verification script or CI check that production `dist` does not contain editor chunk names or `/__model-editor` strings.

3. Production server deny rule:
   - Update [nginx.conf](apps/client/nginx.conf) with explicit denies before the SPA fallback:
     - `location = /editor { return 404; }`
     - `location ^~ /editor/ { return 404; }`
     - `location ^~ /__model-editor/ { return 404; }`
   - This is required because the current `location /` fallback would otherwise serve `index.html` for `/editor`.

4. Dev save endpoint isolation:
   - Any file-write endpoint must be a Vite dev-server middleware only.
   - It must exist only during `vite serve`, not `vite build`, `vite preview`, server deployment, or nginx production.
   - Use a local path allowlist so saves can only write model definition files under the intended generated model directory.

5. Runtime fallback:
   - If someone reaches `/editor` in a non-dev client, show a not-found screen or redirect to menu.
   - Never initialize editor state, save endpoints, or editor imports outside dev.

## Model Standardization First

Before creating the editor, refactor model data into a shared visual schema. This keeps the editor from directly manipulating today's hard-coded JSX and constant islands.

Suggested files:

- `apps/client/src/heroModels/schema.ts`
- `apps/client/src/heroModels/bodyModels.ts`
- `apps/client/src/heroModels/viewmodelModels.ts`
- `apps/client/src/heroModels/animationPresets.ts`
- `apps/client/src/heroModels/heroImplementationExport.ts`
- `apps/client/src/heroModels/registry.ts`
- `apps/client/src/heroModels/validation.ts`
- `apps/client/src/heroModels/generated/*.json`

Core concepts:

```ts
type Vector3Tuple = [number, number, number];

interface HeroVisualModelDefinition {
  id: string;
  heroId: HeroId;
  displayName: string;
  body: HeroBodyModelDefinition;
  viewmodel: HeroViewmodelDefinition;
  animations: HeroAnimationSetDefinition;
}

interface HeroVisualPart {
  id: string;
  name: string;
  kind: 'box' | 'sphere' | 'cylinder' | 'cone';
  material: string;
  position: Vector3Tuple;
  rotation?: Vector3Tuple;
  scale: Vector3Tuple;
  emissive?: boolean;
  transparent?: boolean;
}

interface HeroBodyPart extends HeroVisualPart {
  bone: HeroBoneName;
}

interface HeroSocketDefinition {
  id: string;
  socketName: string;
  owner: HeroBoneName | string;
  position: Vector3Tuple;
  rotation?: Vector3Tuple;
  required?: boolean;
}

interface HeroAnimationSetDefinition {
  bodyClips: HeroAnimationClipDefinition[];
  viewmodelClips: HeroAnimationClipDefinition[];
  presetsUsed: string[];
}

interface HeroAnimationClipDefinition {
  id: string;
  name: string;
  target: 'body' | 'viewmodel';
  role: 'idle' | 'locomotion' | 'attack' | 'ability' | 'transition' | 'custom';
  durationSeconds: number;
  loop: boolean;
  keyframes: HeroAnimationKeyframeDefinition[];
}

interface HeroAnimationKeyframeDefinition {
  timeSeconds: number;
  transforms: Record<string, {
    position?: Vector3Tuple;
    rotation?: Vector3Tuple;
    scale?: Vector3Tuple;
  }>;
}
```

Full-body standardization:

- Move `PHANTOM_PARTS`, `HOOKSHOT_PARTS`, `BLAZE_PARTS`, `CHRONOS_PARTS`, material palettes, team accents, bone pivots, and remote socket markers out of [HeroVoxelBody.tsx](apps/client/src/components/game/HeroVoxelBody.tsx).
- Give each part and socket a stable ID.
- Keep the existing animation code, but make it consume model definitions.
- Add `modelOverride?: HeroBodyModelDefinition` so the editor can render unsaved draft data.

First-person standardization:

- Extract repeated hand, forearm, staff, hook launcher, and Chronos orb geometry into definition-backed reusable renderers.
- Keep the current live pose logic, but separate "render these pieces" from "sample game state and animate them."
- Add an editor preview path that can render viewmodels without `useGameStore`.
- Add `modelOverride?: HeroViewmodelDefinition` for editor drafts.

Animation standardization:

- Keep current procedural animation behavior for shipped heroes while introducing definition-backed animation clips for new and edited models.
- Store reusable animation presets separately from hero instances.
- Let animation clips target stable part IDs, bone IDs, socket IDs, and viewmodel group IDs.
- Support both authored keyframes and parameterized procedural presets, such as walk cycle intensity, attack recoil amount, hand spread, staff charge pose, and orb hover.
- Export animation metadata with model data so a new hero's visual behavior can be reviewed and wired into gameplay deliberately.

## Editor Route

Implementation:

- Create `apps/client/src/modelEditor/ModelEditorPage.tsx`.
- Add an early dev-only route in [App.tsx](apps/client/src/App.tsx).
- Lazy-load `ModelEditorPage` only when `config.isDev` and `pathname === '/editor'`.
- Keep the editor in a separate chunk for development clarity and production exclusion checks.

Pseudo-shape:

```tsx
const ModelEditorPage = lazy(() => import('./modelEditor/ModelEditorPage'));

if (config.isDev && window.location.pathname === '/editor') {
  return (
    <Suspense fallback={null}>
      <ModelEditorPage />
    </Suspense>
  );
}
```

During implementation, ensure this is structured so production builds do not retain the import path.

## Editor Layout

The first screen should be the usable editor, not a landing page.

Layout:

- Top toolbar:
  - Select, move, rotate, scale.
  - Local/world transform toggle.
  - Snap toggle and snap amount.
  - Duplicate, delete, mirror left/right.
  - Undo, redo.
  - Import, export, save dev file.
- Left panel:
  - Hero selector.
  - Visual model variant selector.
  - Body/Viewmodel tabs.
  - Part tree grouped by bone or viewmodel group.
  - Socket list.
  - Animation clip list.
  - Preset library.
- Center scene:
  - React Three Fiber scene.
  - `TransformControls` for selected part/socket.
  - `OrbitControls` for scene navigation.
  - Body mode and first-person mode cameras.
- Right inspector:
  - Stable ID and display name.
  - Kind/material.
  - Position, rotation, scale numeric fields.
  - Bone/group assignment.
  - Socket ownership and required socket status.
  - Visibility flags: emissive, transparent, team accent.
- Bottom strip:
  - Timeline with keyframes.
  - Preview states: idle, walk, run, crouch, crouch-walk, slide, jump, attack.
  - First-person states: idle, primary fire, secondary fire, targeting, charge, ability pose.
  - Preset application controls.
  - Validation warnings.

## Camera Representation

The editor scene must show a visible camera object, similar to Blender.

Requirements:

- Render a named `Camera` object in the 3D scene.
- Show a frustum wireframe with near plane, far direction, and forward ray.
- Show the camera body as a small box/pyramid icon with lens direction.
- Make the camera selectable from the scene or object tree.
- Show camera properties in the inspector:
  - position
  - rotation
  - FOV
  - near/far
  - target/look-at point
- Add a "View Through Camera" toggle.
- Add a small picture-in-picture preview when editing body mode, so model framing can be checked while orbiting freely.
- For first-person mode, show the player's view camera, eye height, weapon/viewmodel root, and the viewmodel anchor offset.

This is especially useful because first-person models can look correct in orbit view but wrong through the gameplay camera.

## Scale And Gameplay Guides

The editor must provide useful guides that show normal hero size and gameplay bounds.

Required guides:

- World unit grid with labeled major lines.
- Height ruler beside the model, marked in meters/game units.
- Default hero height markers:
  - Phantom/Hookshot baseline: 1.8.
  - Blaze/Chronos taller baseline: 1.9 where applicable.
- Gameplay collision capsule guide:
  - Radius from `PLAYER_RADIUS`.
  - Standing height from hero stats or `PLAYER_HEIGHT`.
  - Crouch height from `PLAYER_CROUCH_HEIGHT`.
- Combat hitbox guide:
  - Show padded outline using `PLAYER_COMBAT_HITBOX_PADDING`.
- Eye-height guide:
  - Horizontal eye line from `PLAYER_EYE_HEIGHT`.
  - First-person camera line and forward direction.
- Ground plane and foot contact guide.
- Optional ghost overlays:
  - Current shipped model as translucent reference.
  - Selected hero's default model while editing a variant.
  - Team accent overlay preview.

Guide controls:

- Toggle each guide independently.
- Preset guide modes:
  - "Visual Sculpt"
  - "Gameplay Bounds"
  - "Socket Alignment"
  - "First-Person Framing"

## Socket Editing And Validation

Sockets should be editable objects with distinct markers and labels.

Required sockets:

- `phantom.primary.leftPalm`
- `phantom.primary.rightPalm`
- `phantom.voidRay.orb`
- `hookshot.hook.leftTip`
- `hookshot.hook.rightTip`
- `blaze.rocket.staffTip`
- `chronos.primary.orb`

Validation should flag:

- Missing required socket.
- Duplicate socket names.
- Socket attached to an invalid bone/group.
- Socket outside reasonable distance from its owner bone/group.
- Socket too far from server fallback offsets in [physics.ts](packages/shared/src/constants/physics.ts).
- First-person socket and remote/full-body socket that clearly disagree for the same ability.
- Projectile/beam origin likely to appear detached from visual geometry.

The editor should include a "Socket Alignment" preview that draws:

- Socket marker.
- Forward ray.
- Server fallback origin.
- Delta line between edited socket and fallback.
- Ability-specific labels.

## Animation Authoring And Presets

The editor should let us build and animate heroes, not only inspect static models.

Animation modes:

- Full-body animation authoring:
  - Idle breathing and aura motion.
  - Walk, run, crouch-walk, jump, slide, and landing poses.
  - Primary attack, secondary attack, ability, ultimate, and hit reaction poses.
  - Optional animation layering, such as locomotion plus upper-body attack.
- First-person viewmodel animation authoring:
  - Idle bob.
  - Primary fire recoil.
  - Secondary fire pose.
  - Ability charge/hold/release.
  - Targeting pose.
  - Reload or recovery pose where relevant.
  - Weapon-specific movement such as staff swing, hook launcher recoil, palm caster spread, or floating orb pulse.

Preset library:

- Body archetype presets:
  - Standard humanoid.
  - Heavy/tank humanoid.
  - Agile/flanker humanoid.
  - Floating/caster silhouette.
  - Staff wielder.
  - Dual-hand caster.
  - Hook/launcher user.
- Animation presets:
  - Neutral idle.
  - Heavy idle.
  - Agile idle.
  - Standard walk/run cycle.
  - Crouch walk.
  - Slide.
  - Jump anticipation/air/land.
  - One-hand projectile attack.
  - Two-hand caster attack.
  - Staff charge/release.
  - Hook launcher fire/retract.
  - Orb charge/release.
  - Shield/guard pose.
- Viewmodel presets:
  - Dual hands.
  - Single dominant weapon hand.
  - Staff held in one hand.
  - Staff braced with off hand.
  - Palm caster.
  - Hook launcher.
  - Floating catalyst/orb.

Animation workflow:

1. Choose or create an animation clip.
2. Apply a preset as a starting point.
3. Scrub the timeline.
4. Move bones, parts, viewmodel groups, and sockets.
5. Add or update keyframes.
6. Adjust easing, loop mode, blend-in, and blend-out.
7. Preview in body camera and first-person gameplay camera.
8. Validate sockets throughout the animation, not only at rest.

Animation validation:

- Required sockets must remain present for all clips.
- Ability sockets should stay within configured max distance from expected gameplay origins.
- First-person models should not clip through the camera near plane in gameplay camera preview.
- Full-body animations should stay within reasonable collision and combat hitbox guides unless explicitly marked as a visual-only overhang.
- Looping clips should have compatible first and last keyframes.
- Export should include warnings when authored animation requires gameplay code support that does not exist yet.

## Creating New Hero Visuals

New hero visual flow:

1. Choose an existing hero, a blank new-hero starter, or an archetype.
2. Pick a body archetype and viewmodel archetype.
3. Pick initial animation presets.
4. Build/edit body geometry, materials, bones, accents, and sockets.
5. Build/edit first-person geometry, camera framing, weapon/caster objects, and sockets.
6. Author or tune body and first-person animation clips.
7. Validate required parts, sockets, camera framing, collision guides, and animation clips.
8. Save as a visual model variant or export as a new-hero implementation package.

Archetypes:

- Humanoid full body.
- Dual-hand caster viewmodel.
- Hook launcher viewmodel.
- Staff weapon viewmodel.
- Floating orb/catalyst viewmodel.

This keeps "new visuals for an existing hero" separate from "fully implemented gameplay hero," but the editor should make the next implementation step much easier.

## New-Hero Implementation Export

Export/save should produce more than one raw model JSON file. It should produce an implementation-ready package that makes adding the new hero to the codebase mechanical and reviewable.

Implementation package contents:

- `model.json`:
  - Body parts.
  - Viewmodel parts.
  - Materials.
  - Team accent parts.
  - Required sockets.
  - Camera/viewmodel framing.
- `animations.json`:
  - Body clips.
  - Viewmodel clips.
  - Presets used.
  - Clip roles such as idle, locomotion, primary, secondary, ability, ultimate.
- `sockets.json`:
  - Socket names.
  - Owner bones/groups.
  - Rest transforms.
  - Per-animation bounds or sampled min/max positions.
  - Suggested server fallback offsets.
- `hero-manifest.json`:
  - Proposed hero ID.
  - Display name.
  - Role.
  - Movement focus.
  - Placeholder stats.
  - Ability slot placeholders.
  - Visual model ID.
  - Animation set ID.
- `IMPLEMENTATION.md`:
  - Exact code touchpoints to implement the hero.
  - Suggested diffs/snippets for `HeroId`, `HERO_DEFINITIONS`, visual registry, preview registry, socket constants, and placeholder ability IDs.
  - Checklist for server ability handling, client ability hooks, HUD icons, sounds, effects, and balance.
  - Validation warnings that must be resolved before the hero can be considered playable.

The export should not silently modify shared gameplay files for a new hero unless a later explicit codegen workflow is added. It should create a clear implementation package that a developer can apply intentionally.

## Persistence

Use three persistence layers:

1. Draft autosave:
   - Store unsaved drafts in localStorage.
   - Include schema version and source model ID.

2. Import/export:
   - Export JSON through browser download.
   - Export full new-hero implementation packages as a folder-shaped zip or multiple downloaded files.
   - Import JSON through file picker.
   - Validate before applying.

3. Dev file save:
   - Add a Vite dev-only middleware endpoint under `/__model-editor/save`.
   - Write validated JSON into `apps/client/src/heroModels/generated/`.
   - Write generated implementation packages under a dev-only ignored/staged review folder, such as `apps/client/src/heroModels/generated/newHeroExports/`, when explicitly requested.
   - Never expose this endpoint in production, preview, or the game server.

## Implementation Phases

### Phase 1: Schema And No-Behavior-Change Refactor

- Add model schema and registry.
- Move full-body part arrays, body materials, team accents, bone pivots, and socket markers into model files.
- Make [HeroVoxelBody.tsx](apps/client/src/components/game/HeroVoxelBody.tsx) consume model definitions.
- Add validation tests for shipped model definitions.
- Verify client typecheck.

### Phase 2: First-Person Model Separation

- Extract reusable viewmodel geometry definitions.
- Separate live animation state from static geometry rendering.
- Add an editor-safe viewmodel preview renderer.
- Preserve current gameplay behavior.
- Verify socket samplers still match rendered sockets.

### Phase 3: Animation Schema And Presets

- Add body and viewmodel animation clip schemas.
- Add reusable animation preset definitions.
- Add adapters so existing shipped procedural animations can remain available while new models can use definition-backed animation clips.
- Add validation for keyframe targets, loop compatibility, socket presence during clips, and first-person camera clipping.
- Add starter animation presets for humanoid locomotion, caster attacks, staff attacks, hook launcher recoil, orb charge/release, and viewmodel idle bob.

### Phase 4: Dev-Only Route And Lockdown

- Add `/editor` dev route.
- Add production nginx 404 rules for `/editor`, `/editor/*`, and `/__model-editor/*`.
- Ensure editor chunk is not imported in production.
- Add production build grep/check for editor-only strings.
- Add a non-dev fallback screen or redirect.

### Phase 5: Full-Body Build Editor

- Build editor shell.
- Render full-body draft model.
- Add object tree, selection, transform controls, inspector fields, material selection, duplicate/delete, mirror, and undo/redo.
- Add body archetype presets and part presets.
- Add body animation preview states using the existing full-body animation system and new animation clips.

### Phase 6: Camera And Scale Guides

- Add Blender-style camera object and frustum.
- Add view-through-camera mode and preview inset.
- Add height ruler, collision capsule, combat hitbox, eye-height line, ground plane, and ghost reference overlays.
- Add guide presets.

### Phase 7: Socket Tooling

- Render editable socket markers.
- Add socket inspector and transform support.
- Add validation panel.
- Add socket alignment preview with fallback origins and delta lines.
- Add per-animation socket validation while scrubbing.

### Phase 8: First-Person Build Editor

- Add first-person model tab.
- Render viewmodel through gameplay camera.
- Add free orbit inspection and camera-view inspection.
- Add pose preview controls for idle, primary, secondary, targeting, charge, and ability states.
- Add viewmodel archetype presets and weapon/caster object presets.
- Add socket alignment checks for first-person ability origins.

### Phase 9: Animation Authoring UI

- Add timeline, keyframes, clip selection, clip duplication, and playback controls.
- Add preset application controls for full-body and first-person clips.
- Add easing, loop, blend-in, and blend-out controls.
- Allow keyframing bones, parts, sockets, and viewmodel groups.
- Add side-by-side comparison against shipped animation or selected preset.

### Phase 10: Save, Import, Export

- Add localStorage draft autosave.
- Add JSON import/export.
- Add Vite dev-only save endpoint.
- Validate before save.
- Pretty-print generated JSON for code review.
- Export model, animation, socket, and manifest JSON together.

### Phase 11: New-Hero Implementation Package

- Add a new-hero export wizard.
- Collect proposed hero ID, display name, role, movement focus, rough stats, and ability placeholders.
- Generate `model.json`, `animations.json`, `sockets.json`, `hero-manifest.json`, and `IMPLEMENTATION.md`.
- Include suggested code snippets and exact code touchpoints for adding the hero intentionally.
- Include validation warnings and missing gameplay implementation checklist items.

### Phase 12: Polish And Tests

- Add keyboard shortcuts for common editor actions.
- Add validation tests for all shipped and generated model definitions.
- Add validation tests for animation clips and generated implementation packages.
- Add production-lockdown checks.
- Run `pnpm --filter @voxel-strike/client typecheck`.
- Do not browser-test from agent work; user will verify visually.

## Risks And Mitigations

- Risk: First-person code is currently heavily bespoke.
  - Mitigation: extract static geometry first, keep live pose logic unchanged until preview renderer is stable.

- Risk: Animation editing can grow into a full DCC tool.
  - Mitigation: keep the animation system purpose-built around Opus Strike presets, stable hero bones/groups, sockets, and gameplay camera previews.

- Risk: Socket edits can make gameplay visuals misleading.
  - Mitigation: sockets are required, labeled, validated, and compared against server fallback origins.

- Risk: `/editor` leaks into production through SPA fallback.
  - Mitigation: combine frontend dev-only import, production bundle grep, and explicit nginx deny rules.

- Risk: Generated model JSON drifts from TypeScript expectations.
  - Mitigation: version schema, validate at load, and test shipped/generated definitions.

- Risk: New-hero exports imply gameplay is complete.
  - Mitigation: call exports implementation packages, include explicit TODO checklists, and avoid modifying shared gameplay files automatically in this milestone.

## Acceptance Criteria

- `/editor` works in Vite dev only.
- `/editor` and `/__model-editor/*` return 404 in production nginx.
- Production build does not include editor code or dev save endpoint strings.
- Existing hero visuals render unchanged after schema extraction.
- Full-body editor can clone a hero, build/edit parts, edit sockets, apply presets, author animation clips, preview poses, and export JSON.
- First-person editor can build/edit viewmodel parts, apply presets, author viewmodel clips, and preview through gameplay camera framing.
- Camera object/frustum is visible and selectable.
- Scale guides clearly show hero height, collision capsule, combat hitbox, eye line, and ground contact.
- Required socket validation catches missing or obviously detached ability origins.
- Animation validation catches missing targets, broken loops, camera clipping, and socket drift during clips.
- New-hero export produces `model.json`, `animations.json`, `sockets.json`, `hero-manifest.json`, and `IMPLEMENTATION.md`.
- The generated implementation package clearly lists the code changes needed to turn the visual/animation package into a playable hero.
