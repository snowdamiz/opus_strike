# 3D Model System Refactor Plan

## Reader And Outcome

This plan is for an engineer who needs to make the procedural hero bodies, first-person arms, weapons, sockets, and animation code easier to extend without changing gameplay behavior first.

After reading it, they should be able to start the refactor in small slices, preserve the current look, and avoid breaking ability launch origins.

## Current Shape

The current implementation has a strong foundation: the game already uses shared socket names, shared projectile fallback offsets, reusable effect geometries, live remote-body sockets, and pure-ish pose samplers for some first-person launch points.

The main issue is that the responsibilities are still scattered.

- The full-body hero component owns hero mesh data, material palettes, rig bone definitions, bone inference, pose blending, socket marker definitions, socket registration, opacity handling, and rendering.
- The first-person viewmodel owns shared hand/forearm geometry, hero-specific weapon geometry, root camera coupling, locomotion bob, ability event pulses, socket registration, pose samplers, and per-hero rendering.
- The pose helper modules mostly track held/release state and expose timings. The actual transform logic still lives inside the React viewmodel component.
- Socket names are shared, but each consumer decides how to sample or fall back. Local viewmodel sockets, remote model sockets, server fallback sockets, and observed ability effects do not all go through one semantic resolver.
- Hero preview, remote players, observed ability effects, local prediction hints, and server-origin reconciliation all depend on the same conceptual data but access it through different APIs.

This makes new hero/model work expensive because a change to one visual anchor can require edits in body rendering, viewmodel rendering, local ability hints, remote effects, server fallback offsets, and per-ability handlers.

## Target Direction

Introduce a small model system that separates data, rigging, pose composition, socket lookup, and rendering.

The goal is not to replace the procedural voxel style. The goal is to make it declarative and reusable.

## Proposed Architecture

### 1. Hero Model Manifest

Create one manifest per hero that describes the hero in a shared vocabulary.

Each manifest should include:

- `heroId`
- material palette tokens
- body parts
- team accent parts
- body socket markers
- viewmodel parts or component kit selection
- weapon sockets
- default fallback socket offsets
- optional hero-specific pose layers

The full body and first-person viewmodel should import this manifest instead of duplicating hero colors, socket choices, and weapon attachment rules.

### 2. Shared Rig Definition

Centralize the rig vocabulary.

The shared rig should define:

- bone names
- base pivots
- parent-child hierarchy
- canonical side type
- transform type
- part-to-bone assignment rules
- helpers to group parts by bone
- helpers to build socket marker groups

The current body component already has most of this logic. The first slice should extract it without changing output.

### 3. Pure Pose Layers

Move animation math out of rendering components into pure pose layers.

A pose layer receives a model context and writes additive transforms to a rig pose:

- idle
- locomotion
- crouch
- jump
- slide
- attack
- hero-specific additive layers
- viewmodel root
- viewmodel locomotion
- ability hold/release pulses

Rendering components should mostly apply the current pose. They should not own the animation rules.

This makes pose math testable without mounting React or rendering in a browser.

### 4. Unified Socket System

Replace the split local/remote socket APIs with a single semantic socket resolver.

The resolver should understand:

- local first-person sockets
- remote full-body sockets
- preview sockets, if needed later
- sampled sockets computed from pure pose functions
- registered object sockets
- fallback offsets from shared gameplay constants

Consumers should ask for a semantic origin such as:

`resolveAbilitySocketOrigin({ ownerScope, playerId, abilityId, socketRole, side })`

Instead of directly knowing whether to call a viewmodel registry, a remote registry, a pose sampler, or a fallback helper.

### 5. Ability Socket Catalog

Add a central catalog that maps abilities to socket roles.

Examples:

- Phantom primary uses left or right palm.
- Phantom void ray uses the void ray orb.
- Hookshot primary and grapple use left or right hook tip.
- Blaze rocket, bomb, flamethrower, and rocket jump use the staff tip.
- Chronos primary and conduit-style effects use the primary orb.

This catalog should be shared by local cast-origin hint building, observed remote effects, and server fallback validation. The server cannot use client visual transforms, but it can use the same semantic mapping and fallback offsets.

### 6. Viewmodel Part Kit

Create reusable viewmodel primitives.

The current viewmodel repeats hand, finger, forearm, glow, and weapon attachment patterns. A viewmodel kit should provide:

- poseable hand
- forearm
- palm socket
- closed/open finger rows
- weapon mount socket
- simple procedural weapon builders
- optional per-hero overlays

Hero-specific viewmodels should become small assemblies of shared kit pieces plus custom weapon pieces.

### 7. Runtime Pose State

Replace module-level hero pose globals with an explicit viewmodel pose state.

Today, held states and timed events are stored in module variables. That works for a single local player, but it hides dependencies and makes tests harder.

Move toward a small runtime state object with:

- held inputs
- transition timestamps
- shot/release events
- animation revisions
- sampled movement snapshot
- current hero id

This state can live near the visual store or inside a dedicated viewmodel pose store. The important part is that pose functions receive state instead of reading hidden globals.

## Migration Slices

### Slice 1: Contracts And Inventory

Add types for model manifests, rig bones, model parts, socket roles, and pose layers. Build a small inventory that maps the current heroes and ability sockets without moving rendering yet.

Deliverables:

- shared model-system types
- ability socket catalog
- no behavior changes
- unit coverage for catalog lookups and side resolution

### Slice 2: Extract Full-Body Rig Core

Move bone names, pivots, hierarchy helpers, part grouping, geometry selection, and socket marker grouping out of the full-body renderer.

Deliverables:

- full-body renderer still produces the same body
- hero preview and remote players keep using the same component API
- tests for part classification and socket marker grouping

### Slice 3: Extract Hero Body Data

Move body parts, team accent parts, color palettes, idle profiles, movement profiles, attack durations, and socket markers into hero manifests.

Deliverables:

- body renderer becomes a generic manifest renderer
- each hero can be found in one manifest
- adding a new body part no longer requires editing animation code

### Slice 4: Extract Full-Body Pose Composer

Move idle, movement, crouch, jump, slide, and attack functions into pure pose-layer modules. The renderer should reset the rig, run layers, then apply transforms.

Deliverables:

- full-body pose math testable without React
- animation blend state isolated from mesh rendering
- current preview modes still map to the same pose inputs

### Slice 5: Centralize Socket Resolution

Introduce the semantic socket resolver and migrate local cast-origin hints, observed ability effects, hookshot owner-position helpers, and ability message handlers to use it.

Deliverables:

- one API for local, remote, sampled, and fallback socket origins
- one ability-to-socket mapping
- dev warnings when live visual sockets diverge from sampled sockets beyond tolerance

### Slice 6: Extract Viewmodel Pose Runtime

Move held-state and event-pulse globals into an explicit viewmodel pose runtime. Migrate Phantom, Blaze, and Chronos pose modules first because they already expose timing helpers.

Deliverables:

- pose runtime can be reset on hero swap, death, pointer unlock, or disabled controller state
- pose samplers no longer depend on hidden module state
- current local cast-origin hint timing remains compatible

### Slice 7: Build Viewmodel Kit Pieces

Extract reusable forearm, hand, finger, palm, and weapon-socket primitives. Keep each hero's visible geometry the same while reducing copy/paste.

Deliverables:

- Phantom, Hookshot, Blaze, and Chronos share the same hand/forearm kit where possible
- hero-specific weapon components become focused and smaller
- socket registration is colocated with socket declarations, not buried in custom meshes

### Slice 8: Clean Up And Document Extension Flow

Write a short contributor guide for adding or editing a hero model.

The guide should cover:

- adding body parts
- adding viewmodel parts
- defining sockets
- adding pose layers
- wiring ability origins
- verifying fallback offsets

## Verification Strategy

Do not use browser testing for this work unless explicitly requested.

Use non-browser checks:

- TypeScript typecheck.
- Unit tests for pure rig helpers.
- Unit tests for ability socket catalog mapping.
- Unit tests for pose timing and sampled socket matrices.
- Unit tests that compare live fallback offsets and catalog mappings for every ability that launches from a weapon or hand.
- Optional snapshot-style tests for manifest structure, not rendered pixels.

Manual visual review can remain with the user after each slice.

## Risks And Guardrails

- Ability origins are gameplay-sensitive. Keep fallback offsets and server validation compatible until the socket catalog is fully migrated.
- Viewmodel and full-body sockets will never be identical, but they should be semantically equivalent. Track drift with development warnings instead of forcing exact equality.
- Avoid a giant rewrite. Each slice should preserve the public component API until the internal system is stable.
- Do not introduce asset-loading complexity yet. The current procedural voxel style is fast to iterate on and should remain the default.
- Keep per-frame allocations low. Pose layers should mutate reusable transform objects instead of creating vectors in hot loops.
- Avoid adding a general animation graph too early. A small ordered pose-layer pipeline is enough for the current scope.

## Suggested First Improvement

Start with the socket catalog and full-body rig extraction.

Those two changes are low-risk and high-leverage:

- They centralize the gameplay-sensitive ability origins.
- They reduce the size of the full-body renderer.
- They create shared vocabulary before touching the large viewmodel component.
- They give tests something concrete to protect while later slices move animation math.

## Acceptance Criteria

The refactor is successful when:

- A hero's body parts, colors, accents, sockets, and viewmodel sockets are discoverable from one manifest.
- A gameplay ability origin is resolved through one semantic socket API.
- Full-body animation math can be tested without React.
- First-person pose sampling can be tested without mounting the viewmodel.
- Adding a new hero does not require editing the generic full-body renderer.
- The existing hero preview, remote player bodies, local viewmodel, observed effects, and server fallback behavior remain visually and functionally compatible during migration.
