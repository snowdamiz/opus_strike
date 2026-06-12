# Map Generation Overhaul Plan

## Reader And Outcome

This plan is for the engineer replacing the current procedural map/building generator.

After reading it, they should be able to implement a deterministic map-generation overhaul where buildings come from a large authored prefab library, are randomly selected and placed by seed, and remain playable, readable, performant, and compatible with the existing CTF layout, minimap, movement, warmup, and server validation systems.

## Problem

Current maps get variety from too much low-level randomness. Terrain, landmarks, building footprints, wall damage, roof variation, entrances, caves, and dressing can all perturb the same playable space. The result is maps with noisy small holes, awkward pockets, jagged building silhouettes, inconsistent entrances, and buildings that look interesting from far away but are often not useful during combat.

The biggest gameplay problem is not that the maps are procedural. It is that the generator authors building geometry at runtime instead of choosing from predesigned, tested building shapes.

## Direction

Keep seeded procedural maps, but move structure generation from "randomly grow and carve buildings" to "choose, orient, and place authored building prefabs."

Map variety should come from:

- Topology selection.
- Tactical slot selection.
- Prefab family and variant selection.
- Rotation, mirroring, team tint, and material palette.
- Controlled exterior dressing.
- Controlled terrain adaptation around prefab pads.

Map variety should not come from:

- Random room accretion.
- Random footprint erosion.
- Random wall holes that affect traversability.
- Random entrance discovery.
- Random building fallback stamps.
- Runtime geometry that has not passed prefab validation.

## Design Principles

- Prefer fewer, better playable shapes over noisy novelty.
- Every building variant must have intentional entrances, exits, traversal loops, sightline behavior, and collision budget.
- Randomness can choose between authored options, but cannot invent core geometry.
- Prefabs must be deterministic by seed and produce identical collision on client and server.
- Terrain should adapt to buildings, not slice through or undercut them.
- Visual damage is allowed only when it does not change required traversal spaces.
- Validation should reject bad placement before stamping, not repair unusable geometry afterward.

## Current System To Preserve

The existing generator already has valuable systems that should remain:

- Seeded CTF layout with spawn points, flag zones, map bounds, topology, and themes.
- Semantic construction layer with route graphs, lanes, protected zones, tactical slots, module instances, and diagnostics.
- Terrain constraints for routes, pads, spawns, flags, and module slots.
- Manifest metadata consumed by client warmup, minimap rendering, server rooms, movement prediction, and anti-cheat.
- Smoke coverage around unsafe grooves, spawn and flag clearance, collider budgets, structure counts, route choices, and diagnostics.

This overhaul should replace the building authoring and placement layer while keeping those downstream contracts stable.

## Target Architecture

The new pipeline should be:

1. Generate match layout, topology, route graph, protected zones, tactical slots, and terrain constraints.
2. Build a structure-placement request from tactical slots.
3. Select authored prefab variants by slot role, topology, theme, team, size budget, and seed.
4. Solve placements with rotation, mirroring, clearance, route, and spacing checks.
5. Apply terrain pads and approach ramps for accepted placements.
6. Stamp prefab voxels into the map.
7. Apply only safe exterior dressing and theme materials.
8. Run semantic validation and budget checks.
9. Emit map manifest metadata for accepted prefab instances.

## Prefab Data Model

Create an authored prefab definition format with these concepts:

- Stable id, display name, family, variant id, and version.
- Slot roles supported by the prefab.
- Footprint shape and exact grid bounds.
- Voxel blueprint layers or compact cell descriptors.
- Required clear cells for entrances, exits, ramps, stairs, bridges, flag approach, and roof access.
- Connector anchors with kind, local position, direction, width, clearance height, and tags.
- Gameplay metadata: cover score, occlusion score, verticality score, sightline blocker score, traversal affordances, interior complexity, and recommended lane roles.
- Placement metadata: allowed rotations, mirrorability, slope tolerance, terrain-pad requirements, boundary clearance, protected-zone clearance, and spacing radius.
- Budget metadata: estimated solid blocks, collider cells, renderable chunks, and worst-case triangle estimate.
- Theme metadata: material slots rather than hardcoded block ids.
- Validation fixtures: expected entrance count, required connected floor regions, minimum headroom, and expected bounds.

The prefab format can be TypeScript data first. A later editor/export format can come after the system proves itself.

## Prefab Library Scope

Build a large variant set from the start so seeded maps still feel varied. Target at least 80 authored building variants across these families:

- Base shells: 8 variants.
- Spawn shelters: 8 variants.
- Flag stands and flag-adjacent cover: 8 variants.
- Midfield blockers: 10 variants.
- Side-lane ruins: 10 variants.
- Defender perches and towers: 8 variants.
- Elevated bridges and bridge outposts: 8 variants.
- Underpasses and tunnel entrances: 6 variants.
- Flank landmarks: 8 variants.
- Hard cover clusters: 8 variants.
- Small filler structures: 10 variants.

Each family should include compact, medium, and large variants where the role supports it. Avoid making many cosmetic duplicates; a variant should meaningfully alter routes, cover, verticality, or silhouette.

## Building Variant Examples

Base shells:

- Open U-shaped base with two side exits and one rear spawn-facing safe exit.
- Split-wall base with offset flag approach and defender alcoves.
- Low bunker shell with roof route and two ground entrances.
- Courtyard base with a protected flag pocket and three readable exits.

Midfield blockers:

- Thick diagonal wall with two flanking cuts.
- Cross-shaped hard-cover hub with center pass-through.
- Hollow arena shell with four entrances and safe interior loop.
- Offset twin blocks that break spawn-to-spawn sightlines without sealing lanes.

Side-lane ruins:

- Two-room ruin with a wide connector.
- Broken market shell with guaranteed pass-through corridor.
- Low platform ruin with climbable roof.
- L-shaped corner cover with one interior shortcut.

Vertical/traversal structures:

- Defender tower with ground bypass and roof access.
- Short skybridge with two ramp approaches.
- Bridge outpost with pods that do not create dead-end rooms.
- Underpass portal pair with clear entry and exit pads.

Small filler structures:

- Knee-high cover rows.
- Half-height barricades.
- Low crates/walls arranged as readable cover beats.
- Theme-specific decorative shells with no collision traps.

## Placement System

Use the existing tactical slots as the main placement input, but replace module selection with prefab selection.

Placement rules:

- A slot declares allowed prefab families, desired footprint size, height band, route role, and budget.
- The selector filters prefabs by slot role, topology, theme compatibility, size, budget, and required connectors.
- The solver tries deterministic candidates: variant, rotation, mirror, local offset, and material palette.
- A candidate is accepted only if its full clearance volume fits inside the map boundary and avoids protected zones.
- A candidate must not block required route corridors unless its role is specifically to occlude or redirect sightlines.
- Entrances must have terrain pads and approach corridors before stamping.
- Prefabs cannot overlap each other unless an explicit connector rule allows a bridge, tunnel, or attached module pair.
- Fallback should select a smaller authored prefab, not generate a random structure.

Placement should produce diagnostics for accepted and rejected candidates:

- Rejection reason.
- Slot id and role.
- Prefab id and variant id.
- Rotation and mirror state.
- Bounds.
- Clearance distances.
- Estimated budget impact.

## Terrain Integration

Terrain must be shaped around accepted prefabs before voxel stamping.

Rules:

- Flatten the exact required footprint pad.
- Smooth a predictable approach band from each connector to the surrounding terrain.
- Preserve route centerlines and spawn/flag pads after prefab terrain shaping.
- For elevated structures, place authored supports and clear approach ramps rather than relying on random support columns.
- Do not carve caves or basins under prefab footprints.
- Do not allow post-process groove repair to be the main way buildings become walkable.

Small natural variation can remain outside prefab pads, lanes, spawns, flags, and protected approach corridors.

## Voxel Stamping

Replace runtime building growth with a prefab stamper:

- Convert prefab local cells to world grid cells using placement transform.
- Apply material slots from the active theme.
- Stamp floors, walls, ceilings, stairs, ramps, supports, rails, roofs, and decorative nonessential details.
- Clear required air volumes for entrances, corridors, rooms, roof routes, and connector approaches.
- Stamp visual damage only from authored optional masks.
- Keep collision-affecting cells deterministic and validation-backed.

The old procedural building plan path should be retired or kept behind a disabled development flag. The older random structure stampers should also be quarantined so fallback generation cannot reintroduce messy buildings.

## Validation

Add prefab-level validation before map-level validation.

Prefab validation should check:

- Every required floor region is connected.
- Each required connector has enough width and headroom.
- No one-cell pits, narrow grooves, or sealed pockets exist inside the prefab.
- Stairs, ramps, and drops fit movement limits.
- Roof routes have intended access and exits.
- Budget metadata matches stamped output within tolerance.
- Rotated and mirrored variants remain valid.

Map-level validation should check:

- Accepted prefab count by role.
- No prefab overlaps protected zones.
- No prefab blocks spawn or flag clearance.
- Required lanes remain passable.
- Sightline blockers still satisfy their purpose.
- Spawn-to-spawn visibility remains controlled.
- Unsafe groove, corner pocket, wall notch, trapped basin, and boundary seam counts stay at zero.
- Collider, chunk, solid block, and estimated triangle budgets remain under target.

## Diagnostics And Tooling

Extend diagnostics so a bad seed can be understood quickly:

- Add prefab library version to the manifest.
- Add accepted prefab instances to construction metadata.
- Add rejected prefab candidates and reason counts.
- Add per-role placement counts.
- Add per-prefab budget totals.
- Add validator summaries for prefab connectivity and connector clearance.
- Add a text debug dump for one seed that lists slot, chosen prefab, transform, and validation result.

Add a deterministic seed corpus:

- Current known smoke seeds.
- Edge-case seeds for every topology.
- Seeds that previously produced holes or unusable buildings.
- Seeds that stress dense structures, bridges, towers, and underpasses.
- A small "golden" set with expected prefab ids and placement counts.

## Implementation Phases

### Phase 1: Prefab Schema And Validator

- Define prefab types, material slots, connector metadata, placement metadata, and budget metadata.
- Create helper functions for rotation, mirroring, bounds, transformed connector anchors, and material resolution.
- Build a prefab validator that can run without generating a full map.
- Author the first 10 prefabs across base, side lane, midfield, tower, and bridge roles.
- Add tests for rotated/mirrored validation, connector clearance, connected regions, and budget estimates.

### Phase 2: Placement Solver

- Replace module-definition selection with prefab selection for tactical slots.
- Implement deterministic candidate ordering from seed, slot id, role, topology, and theme.
- Add placement collision, protected-zone, boundary, route, and spacing checks.
- Produce accepted/rejected prefab diagnostics.
- Keep existing random building generation disabled behind a fallback flag during this phase.

### Phase 3: Prefab Voxel Stamper

- Implement the prefab stamper and material resolver.
- Shape terrain pads and approaches for accepted prefab placements.
- Stamp required air volumes after solid cells so interiors and entrances stay clean.
- Stamp optional visual details from authored masks only.
- Emit prefab instance metadata into the map manifest.

### Phase 4: Library Expansion

- Grow the library to at least 80 variants.
- Cover every tactical slot role with at least 4 compatible variants.
- Add compact fallback variants for constrained placements.
- Add topology-specific variants for ring, hourglass, split-level, diamond, and lane-triad maps.
- Add theme material mappings so variants read differently without changing collision.

### Phase 5: Remove Random Building Geometry

- Delete or disable runtime room accretion, footprint erosion, random entrance selection, and random building fallback stamping.
- Keep only non-structural dressing randomness outside protected play spaces.
- Update diagnostics to report prefab results instead of procedural building-plan results.
- Update smoke assertions from "building plans accepted" to "prefab instances accepted."

### Phase 6: Balance And Polish

- Tune slot weights and family weights by topology.
- Tune cover, occlusion, and verticality targets per lane.
- Review seed corpus results for map readability, lane passability, spawn safety, and building usefulness.
- Adjust or remove variants that create dead rooms, excessive clutter, or dominant sightlines.
- Lock the first prefab library version once the smoke corpus is stable.

## Compatibility Notes

The manifest should remain compatible with existing map consumers:

- Client warmup should still receive a complete voxel manifest.
- Minimap rendering should still use boundary, heightfield, route graph, spawn, flag, and construction metadata.
- Server rooms should still generate the same manifest from the same seed.
- Movement prediction and anti-cheat should still consume the same world collision output.
- Map voting previews should continue to use the semantic preview data.

If manifest metadata changes, increment the constructed map manifest version and provide a short migration note.

## Testing Plan

Do not rely on browser testing for this overhaul.

Automated coverage should include:

- Prefab schema validation tests.
- Prefab rotation and mirror tests.
- Prefab connectivity and connector clearance tests.
- Placement solver tests with fixed tactical slots.
- Seeded full-map smoke tests.
- Budget regression tests.
- Manifest determinism tests comparing repeated generation from the same seed.
- Server/client shared generation tests if both sides consume the same package build.

The existing procedural-building smoke command should become the main full-map regression suite for this work, renamed later if needed.

## Success Criteria

- Maps no longer contain random tiny holes, narrow grooves, or accidental unusable pockets from building generation.
- Every accepted building has authored entrances, readable routes, and validated headroom.
- At least 80 building variants are available.
- Every tactical slot role has multiple compatible prefabs.
- No random runtime building geometry is active in normal generation.
- Full-map generation remains deterministic by seed.
- Collider, chunk, solid block, and generation-time budgets remain within current targets.
- Existing minimap, warmup, server, movement, and anti-cheat consumers keep working.
- Seed corpus smoke tests pass without relying on post-process repairs to make buildings usable.

## Rollout Strategy

Start with a feature flag that swaps only tactical-slot buildings to prefabs. Keep the old generator available for comparison while the first prefab batch is small. Once prefab placement, stamping, and diagnostics pass the seed corpus, make prefabs the default and disable random building fallback. After the 80-variant library lands, remove the old procedural building authoring path.

## Open Decisions

- Whether prefab blueprints should stay as TypeScript data or move to a small external JSON/editor format later.
- Whether to keep caves at all, or limit them to authored underpass prefabs.
- Whether visual damage should be separate variants or optional masks within a variant.
- How much map-vote preview metadata should expose prefab identity versus only high-level labels.
- Whether to build a small local prefab preview tool after the first implementation pass.
