# Procedural Building Generation Plan

## Reader And Goal

This plan is for an internal engineer who needs to replace the current building stamp system with a more genuinely procedural, gameplay-safe building generator.

After reading this, they should be able to implement the change in vertical slices without breaking competitive Capture the Flag map constraints.

## Current State

The map generator is deterministic and seed-driven, but buildings are still mostly authored feature stamps. The generator chooses a feature position, radius, height, material accent, and style, then calls a fixed structure function. Those functions add seeded variation such as noisy footprints, height changes, windows, trims, entrances, and chipped edges.

That produces variety, but it does not truly design a building from rules. Across many seeds, the same silhouette families can reappear because the high-level architectural choices come from a small set of hand-authored archetypes.

## Target State

Buildings should be generated from a grammar:

1. Pick a building intent.
2. Generate a footprint.
3. Split the footprint into rooms, wings, courtyards, bridges, or towers.
4. Generate vertical massing.
5. Place entrances and approach paths.
6. Apply facade rules.
7. Validate gameplay safety.
8. Stamp the validated plan into voxels.

The output should still be deterministic per seed, but the same archetype should not simply repeat with different noise. A seed should produce a building plan, not just a decorated blob.

## Constraints

- Maps must remain deterministic for server and client.
- Red and blue spawn areas, flag areas, and protected routes must stay clear.
- Generated buildings must not create impossible player movement, unreachable flags, spawn traps, or direct spawn sightlines.
- Buildings must stay affordable for chunk generation, collider generation, and client rendering.
- Browser visual testing is left to the user; implementation verification should use typechecks and generator smoke tests.

## Implementation Slices

### 1. Add A Building Plan Model

Create internal data types for a building before it becomes voxels.

Suggested concepts:

- `BuildingPlan`: seed, center, bounds, theme, intent, volumes, entrances, tags.
- `BuildingVolume`: local bounds, floor row, height rows, role, material profile.
- `BuildingOpening`: local position, direction, width, height, purpose.
- `BuildingConnection`: links between volumes, such as hallway, bridge, stairs, ramp, or courtyard edge.
- `BuildingValidationResult`: pass/fail plus reasons and useful metrics.

Keep this model independent from block stamping so it can be tested without walking every voxel.

### 2. Define Building Intents

Replace direct style rolls with higher-level intents.

Good first intents:

- `bunker`: low, wide, strong cover, multiple entrances.
- `tower_cluster`: vertical focal point with several smaller supports.
- `courtyard_fort`: rooms around a hollow playable center.
- `bridge_outpost`: elevated deck connecting two or more pods.
- `market_ruin`: fractured rooms and partial walls.
- `arena_shell`: curved exterior with open interior and balcony edges.

Each intent should set ranges and weights, not final geometry.

### 3. Generate Footprints Procedurally

Build footprints from rules instead of fixed shape formulas.

Start with grid-space footprint generators:

- Rectilinear growth from a seed cell.
- Room accretion with overlap checks.
- Courtyard subtraction.
- Wing extension from room graph edges.
- Edge erosion using seeded noise.
- Optional symmetry bias for some intents.

The footprint generator should produce occupied cells plus semantic zones such as core, wing, courtyard, bridge, or exterior edge.

### 4. Generate A Room Graph

Create a small graph that describes how the building is used.

Example process:

1. Pick a main room count from intent ranges.
2. Add rooms around a core with seeded direction choices.
3. Connect rooms with doors, halls, ramps, or bridges.
4. Mark at least two exterior connections unless the building is intentionally small.
5. Reserve at least one clear traversal path through or around the feature.

This graph becomes the source of entrances, openings, and interior voids.

### 5. Generate Vertical Massing

Use the room graph and intent to assign heights.

Rules to include:

- Taller core, lower wings.
- Alternating roof levels.
- Occasional tower volumes.
- Open courtyard voids.
- Damaged or missing upper levels for ruin intents.
- Elevated deck rows for bridge intents.

Do not stamp final blocks yet. First produce volume heights and floor rows that can be validated.

### 6. Place Entrances And Approach Paths

Entrances should be generated from gameplay needs, not decoration.

Rules:

- Prefer entrances facing nearby lanes or open terrain.
- Require at least two entrances for medium and large buildings.
- Connect entrances to room graph nodes.
- Stamp approach paths that blend to terrain.
- Preserve player headroom.
- Avoid entrances that face directly into protected spawn areas.

If a generated building cannot create safe entrances, reject it and retry with a new local feature seed.

### 7. Apply Facade And Material Rules

Once the plan validates, derive visual block choices.

Facade rules can vary by theme and intent:

- Window bands based on room role and height.
- Accent strips on corners, roof lines, entrances, and towers.
- Glass roofs on cores or atriums.
- Broken wall gaps for ruins.
- Material gradients by height or role.
- Sparse team-neutral neon accents.

This should be a layer over the building plan, not a separate shape generator.

### 8. Validate Gameplay Before Stamping

Add a validator that runs before voxel stamping.

Minimum checks:

- Protected spawn and flag areas are untouched.
- Entrances have enough headroom.
- The building footprint is inside the playable boundary with approach clearance.
- The plan leaves enough route space around the feature.
- No direct spawn-to-spawn sightline is introduced.
- Generated height stays within map bounds.
- Estimated collider and solid block budget is under a configured limit.

Useful metrics:

- Entrance count.
- Interior floor area.
- Exterior cover edge length.
- Maximum height.
- Traversable connection count.
- Distance to spawn and flag zones.

### 9. Stamp From Plans

After validation, convert `BuildingPlan` to voxels.

Stamping should be boring and deterministic:

- Fill support columns.
- Stamp floors.
- Stamp walls.
- Carve interiors.
- Carve openings.
- Stamp roofs.
- Stamp details.
- Stamp approaches.

The important design choices should already be in the plan, not hidden in the stamping function.

### 10. Replace Existing Structure Selection Gradually

Do not replace every stamp at once.

Suggested rollout:

1. Add the building plan generator alongside the existing feature stamps.
2. Use it for one new intent, such as `courtyard_fort`.
3. Add smoke tests and metrics.
4. Route a small percentage of normal structures through the grammar generator.
5. Convert existing citadel and skybridge logic into grammar intents.
6. Keep caves, boulders, natural cover, and sightline baffles as separate feature systems.
7. Remove old building-only stamp paths after the grammar covers enough silhouettes.

## Validation And Tooling

Add a non-browser generator smoke script that can run many seeds and print metrics.

It should check:

- No generation exceptions.
- Expected spawn and flag counts.
- Collider counts remain reasonable.
- Structure block counts are not zero for maps that requested buildings.
- Building validation failure rate is below a target threshold.
- Theme distribution is reasonably varied across sequential and random seeds.

Add optional debug output for a single seed:

- List building intents selected.
- List accepted and rejected feature plans.
- Print rejection reasons.
- Print footprint and volume metrics.

## Acceptance Criteria

- Sequential seeds produce visibly different building silhouettes more often than the current stamp system.
- Buildings are generated from plan data, not direct handwritten voxel loops.
- Each medium or large building has at least two usable entrances.
- Generated interiors or courtyards are actually traversable where intended.
- Spawn and flag protected zones remain clear.
- Typecheck passes for shared, server, and client packages.
- A multi-seed generator smoke test passes without browser testing.

## Suggested Order Of Work

1. Add building plan types and a no-op validator.
2. Implement one footprint generator for rectilinear room growth.
3. Implement one intent: courtyard fort.
4. Stamp from the plan into voxels.
5. Add smoke metrics for accepted buildings and rejection reasons.
6. Wire the intent into a small portion of structure placement.
7. Add bridge outpost and tower cluster intents.
8. Convert existing authored building stamps into plan-backed generators.
9. Tune weights and budgets after user visual review.

## Risks

- Too much randomness can make bad competitive maps.
- Validation can become expensive if it scans full voxel volumes too often.
- Interior spaces can look good but be useless if entrances and headroom are not enforced.
- More vertical structures can increase collider count and rendering cost.
- Fully procedural shapes can become visually noisy without strong material and facade rules.

## Recommendation

Use a constrained grammar, not pure random generation. The generator should make many small procedural choices, but every choice should be bounded by gameplay validation. That gives maps a much larger design space while preserving the authored feel and competitive readability the current system needs.
