# Plan: Admin Hero Editor And Animator

## Reader And Goal

**Reader:** A future engineer implementing the hero editor without this conversation.

**Post-read action:** Turn this plan into implementation slices that add an admin-only `/editor` route where an admin can create, validate, publish, and use a new hero end to end.

## North Star

The editor should let an admin create a hero from blank draft to live game pick without hand-editing code for the normal path:

1. Define the hero identity, role, stats, hitbox, movement profile, and ability loadout.
2. Build the full-body third-person model using the game's voxel/rig/socket system.
3. Build the first-person viewmodel using the same socket and pose-channel language used by existing heroes.
4. Author animations for idle, movement, jump, slide, crouch, primary fire, secondary fire, abilities, and ultimate.
5. Create skills through safe, server-authoritative templates or graph nodes.
6. Preview the hero in editor scenarios.
7. Publish a versioned hero that appears in hero select and behaves like Phantom, Hookshot, Blaze, and Chronos.

This is not a generic Blender replacement. It is a bespoke game tool that edits the exact concepts the game already uses: voxel parts, material tokens, rig bones, sockets, pose channels, ability origins, viewmodels, server-authoritative skills, and shared hero definitions.

## Current Repo Signals

- The game currently has four static heroes: Phantom, Hookshot, Blaze, and Chronos.
- Hero selection, bot selection, movement, ability initialization, UI presentation, and tests are still built around a static `HeroId` union and static hero/ability registries.
- The model system is already close to editor-ready. It has a `HeroModelDocumentV1` schema with full-body parts, team accent parts, sockets, first-person viewmodel parts, materials, pose channels, fallback sockets, and validation.
- Existing model tests already prove custom editor-authored hero ids, materials, and socket roles can validate at the document level.
- Full-body rendering is procedural and rigged through named bones. First-person rendering is bespoke per hero today, with reusable model documents plus per-hero pose runtime code.
- Ability socket origins already flow through cataloged sockets, local viewmodel sockets, remote body sockets, and fallback offsets.
- Admin access already exists through an admin route and admin API guarded by the configured admin wallet, session cookie, and CSRF protection for mutations.

## Product Scope

### Route And Access

- Add a new client route at `/editor`.
- Keep it outside the normal match/lobby app-phase router, similar to the existing admin dashboard route split.
- Use the existing admin authorization model. Reads should require the same admin session guard. Mutations should use the same CSRF pattern as current admin mutations.
- Mount the editor as an admin tool, not a player-facing screen. Non-admin users should receive the same hidden failure behavior as other admin-only endpoints.

### Editor Workspaces

The editor should be organized around a single hero project with these panels:

1. **Hero Setup**
   - Slug, display name, role, description, color palette, stats, capsule size, movement focus, and default inputs.
   - Ability slot assignment for primary, secondary, ability 1, ability 2, and ultimate.

2. **Full-Body Model**
   - Add, duplicate, group, hide, lock, and delete voxel parts.
   - Edit part kind, material token, color, emissive state, transparency, bone target, position, rotation, and scale.
   - Show skeleton pivots, hitbox bounds, team accent overlays, bot marker, and socket gizmos.
   - Validate against `HeroModelDocumentV1`.

3. **First-Person Model**
   - Build viewmodel arms, hands, held objects, weapons, or magic props.
   - Edit root offset and optional field of view.
   - Share material tokens with the full-body model where useful, while allowing viewmodel-only materials.
   - Register local viewmodel sockets for skill origins.

4. **Animation Timeline**
   - Timeline tracks for root, bones, parts, materials, sockets, and viewmodel pose channels.
   - Keyframes for transform, visibility, emissive intensity, opacity, and event markers.
   - Named clips for idle, walk, run, crouch, crouch-walk, jump, slide, attack, reload/cast, skill start, skill hold, skill release, ultimate start, and ultimate loop.
   - Clip blending metadata so gameplay can transition without popping.

5. **Skill Builder**
   - Declarative skill graphs, not arbitrary runtime code.
   - Whitelisted server-authoritative nodes for projectile spawn, hitscan/raycast, area field, status effect, heal, shield, impulse, teleport, movement modifier, deployable, cooldown, charges, resource cost, and ultimate charge.
   - Client-side companion nodes for viewmodel pose, socket origin hint, sound event, screen feedback, remote VFX, and impact VFX.
   - Explicit target modes: self, direction, ground point, area, ally, enemy, projectile hit, and triggered zone.
   - Every graph compiles to a server validation plan and a client presentation plan.

6. **Preview And Publish**
   - Preview modes for full body, first person, hero select card, remote enemy, remote ally, bot, flag carrier, and ability cast.
   - Validation report for schema errors, missing sockets, missing required clips, invalid skill graph nodes, out-of-range stats, and runtime compatibility.
   - Versioned publish flow with draft, reviewed, published, deprecated, and archived states.
   - Rollback to a previous published hero revision.

## Data Model

Create a persisted editor domain rather than saving only static source files.

### Hero Project

Stores the stable project identity:

- Project id
- Hero slug
- Current draft revision
- Current published revision
- Created and updated metadata
- Archived flag

### Hero Revision

Stores immutable revisions:

- Hero metadata document
- `HeroModelDocumentV1`
- Animation document
- Skill graph document
- Generated compatibility summary
- Author admin user id
- Status and timestamps

### Publish Record

Stores the deployment trail:

- Revision id
- Published by admin user id
- Validation result
- Runtime catalog version
- Rollback source, when applicable

### Audit Log

Stores admin actions:

- Create project
- Save draft
- Duplicate revision
- Validate
- Publish
- Roll back
- Archive
- Delete draft

## Document Schemas

### Hero Metadata Document

This should become the data-driven replacement for the static hero definition:

- Hero id and display name
- Role and movement focus
- Description
- Health, move speed, jump force, capsule dimensions
- Passive text or passive skill reference
- Ability slot references
- Hero select presentation metadata

### Model Document

Use the existing model document schema as the canonical model output. Extend only when the editor exposes concepts the schema cannot represent. Avoid creating a parallel model format.

Likely extensions:

- Editor-only grouping metadata
- Locked/hidden selection state
- Optional tags for part search and organization
- Optional thumbnail camera metadata

Keep editor-only data outside the runtime payload when possible.

### Animation Document

Add a new schema for authored animation clips:

- Clip id, label, duration, loop mode, blend duration
- Track target: root, bone, part, material, socket, or viewmodel channel
- Track property: position, rotation, scale, opacity, emissive intensity, visibility, or event
- Keyframes with interpolation
- Required gameplay tags such as `idle`, `walk`, `run`, `slide`, `primaryFire`, and `ultimate`
- Event markers for skill windows, socket sampling, sound cues, VFX cues, and hit windows

The runtime should compile this to efficient reusable samplers instead of interpreting large editor data every frame.

### Skill Graph Document

Add a versioned declarative skill graph:

- Skill id, display name, input slot, cooldown, charges, resource rules, targeting, and description
- Server graph for authoritative gameplay effects
- Client graph for prediction, camera, audio, viewmodel, and observed VFX
- Required sockets and required animation clips
- Balance metadata for review

The server must reject unknown nodes and invalid parameters. Admin-authored skills should never execute arbitrary JavaScript from the database.

## Runtime Architecture

### Hero Catalog

Introduce a runtime hero catalog that can merge built-in heroes and published editor heroes behind one API:

- List playable heroes.
- Resolve hero metadata.
- Resolve stats and capsule dimensions.
- Resolve ability slots.
- Resolve model document.
- Resolve animation clips.
- Resolve skill graphs.
- Resolve hero select presentation metadata.

Existing systems should depend on the catalog instead of direct static maps.

### Static Hero Migration

Use a staged migration:

1. Wrap existing static heroes behind the new catalog.
2. Convert existing model/viewmodel documents into seed catalog entries.
3. Convert existing ability metadata into seed skill definitions where possible.
4. Keep bespoke hardcoded ability behavior only until a declarative graph can express it.
5. Once a hero path is fully data-driven, remove the old duplicate static path.

Legacy code should not remain as a permanent fallback. Each compatibility bridge should have an owner, an exit condition, and tests proving it is no longer needed before removal.

### Server Authority

The server stays authoritative for:

- Hero selection validation
- Stats and movement parameters
- Cooldowns, charges, ultimate charge, and resources
- Damage, healing, shields, impulses, teleports, deployables, and status effects
- Spawned projectiles and area effects
- Anti-cheat relevant movement or ability state

The client may predict and present, but the server decides outcomes.

### Client Presentation

The client consumes the same catalog for:

- Hero select cards
- Full-body remote rendering
- First-person viewmodel rendering
- Socket-origin sampling
- Animation clip playback
- HUD ability cards and cooldown presentation
- Observed ability effects
- Audio and visual prediction

The existing bespoke viewmodel code can be reduced over time by moving common pose behavior into clip samplers and skill presentation nodes.

## Implementation Phases

### Phase 1: Editor Route And Admin API Foundation

Goal: Create the secure shell and persisted draft lifecycle.

Deliverables:

- `/editor` client route with an admin-only editor shell.
- Admin API endpoints for listing projects, loading a project, saving a draft, validating a draft, and publishing a revision.
- Database models for projects, revisions, publish records, and audit logs.
- Shared validation for hero metadata, model document, animation document, and skill graph document.
- Initial "duplicate existing hero into draft" flow.

Acceptance:

- Admin can open `/editor`.
- Non-admin access is hidden.
- Admin can create a draft from an existing hero and save it.
- Draft validation returns structured errors.
- No gameplay systems consume editor drafts yet.

### Phase 2: Full-Body Model Builder

Goal: Let admins build and validate third-person models using the real runtime format.

Deliverables:

- 3D editor viewport with orbit, pan, zoom, grid, axis gizmo, bounds, and hitbox overlay.
- Part CRUD for boxes, spheres, cylinders, and cones.
- Material palette editor.
- Bone assignment and skeleton pivot overlay.
- Team accent editor.
- Socket editor for remote body ability origins.
- Thumbnail capture metadata.

Acceptance:

- A full-body draft exports a valid model document.
- Existing heroes can round-trip through the editor without losing required parts or sockets.
- Missing required sockets are surfaced as validation errors.

### Phase 3: First-Person Viewmodel Builder

Goal: Let admins author first-person models using the same socket and pose-channel model as live heroes.

Deliverables:

- First-person viewport with configurable root offset and field of view.
- Viewmodel part CRUD.
- Viewmodel materials.
- Local socket editor.
- Pose-channel assignment.
- Side-by-side full-body and viewmodel socket validation.

Acceptance:

- A viewmodel draft exports a valid viewmodel section.
- Required skill sockets can be resolved from local viewmodel data.
- Full-body and first-person models share socket roles where the skill graph requires parity.

### Phase 4: Animation Authoring

Goal: Replace hardcoded pose assumptions with authored clips where possible.

Deliverables:

- Timeline, keyframe editor, clip library, easing controls, and event markers.
- Full-body clip playback using rig bones and root transform.
- Viewmodel clip playback using root, bones, parts, and pose channels.
- Required clip checklist based on the hero's skills and movement profile.
- Runtime animation sampler.

Acceptance:

- Admin can author idle, walk, run, jump, slide, and attack clips.
- Clips blend without visible pose snaps in preview.
- Skill windows and socket sample events can be placed on the timeline.

### Phase 5: Skill Builder

Goal: Create game-ready skills without arbitrary code execution.

Deliverables:

- Skill graph editor with whitelisted nodes.
- Server graph compiler and validator.
- Client presentation graph compiler and validator.
- Skill templates for projectile, hitscan, self-buff, movement burst, area field, deployable, shield, heal, and ultimate mode.
- Balance review panel with damage, cooldown, range, radius, charges, and ultimate rules.
- Skill-to-animation and skill-to-socket dependency report.

Acceptance:

- Admin can create a complete ability loadout for a new hero.
- Server rejects unknown graph nodes and invalid parameters.
- Client can preview the skill using authored sockets and clips.
- Published skills run through the same cooldown, charge, and authority model as existing heroes.

### Phase 6: Publish Pipeline And Runtime Catalog

Goal: Published heroes become playable through one catalog API.

Deliverables:

- Runtime catalog service for built-in and published heroes.
- Server integration for hero selection, ability initialization, bot assignment, matchmaking tickets, movement stats, and game snapshots.
- Client integration for hero select, hero preview, HUD, viewmodel, remote body, effects, and match summary.
- Published revision cache and rollback.
- Admin publish checklist.

Acceptance:

- A published editor hero appears in hero select.
- The hero can be picked, spawned, rendered remotely, rendered in first person, and used in a match.
- Existing heroes still work through the same catalog API.
- Static-only code paths that are now duplicated are removed.

### Phase 7: Existing Hero Round-Trip And Legacy Removal

Goal: Prove the tool can recreate current heroes and then remove obsolete hardcoded paths.

Deliverables:

- Seed drafts for Phantom, Hookshot, Blaze, and Chronos.
- Parity reports comparing static definitions to generated catalog entries.
- Migration checklist for each static subsystem.
- Removal of duplicated static model, animation, socket, and ability metadata after parity.

Acceptance:

- Each current hero can be loaded as an editor project.
- Each current hero can be published from editor data with no gameplay regression.
- Static maps, unions, and switch statements that only exist for editor-replaced data are removed.

## Validation And Testing Strategy

- Shared schema tests for every document type.
- Catalog tests proving built-in and editor-published heroes resolve through the same API.
- Server tests for admin authorization, CSRF, draft persistence, publish validation, and rollback.
- Server gameplay tests for skill graph execution, cooldowns, charges, damage, healing, movement modifiers, and rejection of invalid graphs.
- Client unit tests for model document rendering adapters, animation samplers, socket resolution, and editor state reducers.
- Round-trip tests for existing heroes.
- Performance checks for model part counts, material count, animation sampler cost, and skill graph execution cost.
- Manual browser review remains the user's lane for this repo.

## Risks And Guardrails

- **Scope creep:** Keep the editor focused on this game's voxel rigs, sockets, clips, and skill graphs. Avoid general-purpose mesh editing.
- **Arbitrary code execution:** Skills must be declarative and whitelisted. Database-authored JavaScript should not run on the server or client.
- **Static hero coupling:** Introduce the catalog early so each subsystem migrates toward one resolution path.
- **First-person special cases:** Keep bespoke pose drivers only as temporary bridges. New heroes should prefer authored clips and reusable skill presentation nodes.
- **Balance quality:** Publish should require a balance summary and validation thresholds before a hero is playable.
- **Performance:** Enforce part/material/clip/node budgets at validation time.
- **Rollback:** Every publish must be versioned and reversible.

## Open Decisions

1. Should published heroes load dynamically from the database at server start, or should publish generate checked-in catalog files for review?
2. Should new editor heroes be enabled in all game modes immediately, or gated to custom/practice modes before public matchmaking?
3. What is the first skill graph feature target: projectile hero, movement hero, support hero, or remake of an existing hero?
4. How strict should publish-time balance thresholds be?
5. Should admins be able to import/export hero projects as JSON packages?

## Suggested First Slice

Build a minimal `/editor` that only supports admin access, project creation, duplicating an existing hero into a draft, saving the draft, and validating the existing `HeroModelDocumentV1`. That slice proves the route, auth, persistence, draft/revision model, and shared validation pipeline before the expensive 3D editing surface begins.
