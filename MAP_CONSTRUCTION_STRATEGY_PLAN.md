# Map Construction Strategy Plan

## Reader And Outcome

Reader: an internal engineer replacing the current procedural Capture the Flag map generator.

Post-read action: implement a new layout-first map construction pipeline that keeps the useful renderer, physics, seed determinism, and theme work while moving gameplay design, validation, and map meaning out of ad hoc voxel stamping.

## Goal

The current map generator has become both bloated and primitive. It has thousands of lines of safety fixes, building retries, terrain smoothing, feature stamping, boundary sealing, line-of-sight baffles, cave carving, collider generation, and theme choices. At the same time, the actual map design is still mostly implicit: flags, spawns, lanes, cover, sightlines, landmarks, and traversal roles are inferred from distances and blocks after the fact.

The replacement strategy is to build maps from a semantic gameplay blueprint first, then materialize terrain, landmarks, voxels, colliders, previews, and diagnostics from that blueprint.

In short:

1. Design the CTF match space.
2. Validate the match space.
3. Fill it with terrain and modules.
4. Voxelize it.
5. Derive physics, rendering, previews, and AI data.

## What To Keep

Keep the parts that are already pulling their weight:

- Deterministic generation from seed.
- Shared map generation usable by both server and client.
- Sparse voxel chunks.
- Greedy voxel mesh construction.
- Merged static cuboid colliders.
- Theme-driven materials and texture atlas work.
- Heightfield fast path for ground checks.
- Boundary polygon support.
- Map vote seed and theme flow.
- Existing procedural smoke script as the seed-audit starting point.

These are good foundations. The problem is not that the game uses voxels or procedural maps. The problem is that the generator treats gameplay as something to patch after random geometry exists.

## Current Architecture Read

The shared generator currently owns nearly every concern in one pipeline:

- map footprint, boundary polygon, flags, and spawn clusters
- terrain noise, hills, valleys, ravines, volcanic craters, smoothing, and step limiting
- route terrain shaping between spawns, flags, and midfield
- block filling and themed surface material choice
- caves, tunnels, natural features, boulders, trees, crystals, lava vents, and structures
- planned building generation, validation, stamping, entrances, supports, windows, and approaches
- spawn and flag clearing, painting, and repeated protection passes
- direct spawn line-of-sight detection and baffle stamping
- unsafe groove, corner pocket, trapped basin, and boundary seam sealing
- sparse chunk extraction
- heightfield creation
- collider generation
- diagnostics

The building planner is more structured than the rest of the generator, but it is still being asked to place tactical objects into a world that does not expose tactical slots. In a small smoke sample of 8 seeds, buildings attempted 83 plans, accepted 30, and rejected 53. The top rejection reasons were boundary clearance, entrance approaches outside the boundary, protected route overlap, and height exceeding map bounds. A debug seed showed 19 attempts, 5 accepts, and 14 rejects. That is useful evidence: the generator is repeatedly discovering that placement constraints should have existed before building generation began.

The server regenerates the full manifest from the seed and samples blocks for ground, bot blocking, boundaries, flags, spawns, and unstuck. The client regenerates the full manifest for rendering and physics. The map vote screen also generates candidate manifests for preview camera data and renders the full voxel world to capture thumbnails.

The manifest is therefore both too low-level and too expensive. It says what blocks exist, but not why they exist.

## Core Strategy

Build every map from a layered construction model.

### 1. Design Brief

The design brief is the top-level input. It should be tiny and deterministic:

- seed
- game mode
- team size
- map family
- theme
- target match length
- desired topology
- desired symmetry level
- performance budget

Map family and theme should be separate. A family controls gameplay topology. A theme controls materials, dressing, sky, fog, and flavor. This prevents "frost map" or "volcanic map" from meaning only a visual reskin of the same hidden route logic.

### 2. Gameplay Blueprint

The blueprint is the new center of the system. It describes the match before voxels exist.

It should include:

- boundary
- red and blue base zones
- flag pads
- spawn clusters
- protected zones
- primary lanes
- flank lanes
- return routes
- midfield contest zone
- route graph nodes and edges
- expected travel distances
- expected travel times
- line-of-sight corridors
- occlusion requirements
- cover-density targets
- verticality bands
- traversal affordance hints
- landmark slots
- dressing exclusion zones

The blueprint should be validated before terrain or structures are built. If the blueprint is bad, reject or repair it while it is still cheap.

### 3. Tactical Slots

Instead of asking structures to randomly fit into the world, the blueprint should create typed slots.

Slot examples:

- base shell
- spawn shelter
- flag stand
- midfield occluder
- side-lane cover chain
- flank landmark
- elevated bridge
- tunnel entrance
- defender perch
- soft cover cluster
- hard cover cluster
- traversal ramp
- underpass

Each slot declares its role, footprint, height band, allowed modules, protected clearances, route relationships, and sightline purpose. A structure generator should receive "build an elevated bridge between these route nodes" rather than "try a bridge outpost somewhere around here and see if validation accepts it."

### 4. Module Grammar

Replace most direct stamping functions with a small module grammar.

A module is a reusable map part with declared inputs and outputs:

- role tags
- footprint shape
- height range
- entrance connectors
- exit connectors
- cover contribution
- occlusion contribution
- traversal affordances
- block budget
- collider budget estimate
- allowed themes
- protected-zone behavior
- voxelization function
- local validator

Initial modules should be deliberately few:

- base courtyard
- spawn shelter
- flag pedestal
- midfield wall
- side-lane ruin
- bridge platform
- tunnel segment
- tower perch
- boulder field
- soft natural cover patch

Modules can still be procedural internally. The important change is that they are placed by tactical contract, not by free-floating coordinates.

### 5. Constraint Terrain

Terrain should be generated from gameplay fields, not only noise.

The terrain system should accept masks and constraints from the blueprint:

- lane centerlines
- lane widths
- base pads
- spawn pads
- flag pads
- module pads
- ramp corridors
- no-trap zones
- no-dressing zones
- boundary wall bands
- sightline bands
- cover slots

Noise should add character after these constraints exist. Terrain should never need repeated spawn and flag re-clearing because protected surfaces should be constraints in the first terrain solve.

### 6. Voxelization

Voxelization should be a late materialization step.

Inputs:

- terrain heightfield and material fields
- module instances
- boundary walls
- protected pads
- dressing hints

Outputs:

- sparse chunks
- block ids
- heightfield
- collider regions
- render regions
- semantic metadata

The current chunk and mesh systems can survive this change. The major difference is that the voxel map becomes a compiled artifact of a higher-level design instead of the design itself.

### 7. Derived Products

The manifest should carry more than chunks.

Add semantic derived data:

- route graph
- lane labels
- spawn metadata
- flag metadata
- protected zones
- tactical slots
- module instances
- preview camera hints
- bot navigation hints
- sightline audit samples
- diagnostics and score

Consumers should not have to reverse-engineer gameplay from voxels. The server can still sample blocks for collision and ground, but bots, previews, spawn logic, and map vote should receive explicit map meaning.

## Proposed Manifest Shape

The exact TypeScript can evolve, but the manifest should roughly split into these sections:

```ts
interface ConstructedMapManifest {
  id: string;
  version: number;
  seed: number;
  familyId: string;
  themeId: string;

  gameplay: {
    mode: 'ctf';
    boundary: BoundaryPoint[];
    bases: TeamMap<BaseZone>;
    flags: TeamMap<FlagZone>;
    spawns: TeamMap<SpawnCluster>;
    protectedZones: ProtectedZone[];
    lanes: LaneDescriptor[];
    routeGraph: RouteGraph;
    sightlineSamples: SightlineSample[];
  };

  construction: {
    blueprintId: string;
    topologyId: string;
    moduleInstances: ModuleInstance[];
    tacticalSlots: TacticalSlot[];
    diagnostics: MapDiagnostics;
  };

  world: {
    origin: Vec3;
    voxelSize: VoxelSize;
    size: VoxelSize;
    heightfield: Heightfield;
    chunks: VoxelChunk[];
    colliders: VoxelCollider[];
    stats: MapStats;
  };

  preview: {
    camera: PreviewCameraHint;
    thumbnailSilhouette: PreviewSilhouette;
    labelTags: string[];
  };
}
```

This does not require a huge rewrite of rendering. The client can still read `world.chunks`. The point is to stop making every other system depend on those chunks as the only source of truth.

## Generation Pipeline

### Stage 1: Choose Topology

Pick a topology template from the map family.

Useful first templates:

- lane triad: main lane plus two flanks
- diamond: two bases, two side contests, one midfield contest
- hourglass: strong midfield choke with wider base zones
- ring: circular flank route around a central occluder
- split level: lower fast route and upper risky route

Each topology defines required nodes, optional nodes, symmetry behavior, route length bands, and sightline expectations.

### Stage 2: Solve Blueprint

Place flags, spawn clusters, base zones, lane nodes, and boundary shape from the topology.

Validation targets:

- teams have comparable flag-to-midfield distance
- teams have comparable spawn-to-flag distance
- spawn clusters do not see enemy spawn clusters directly
- spawns have protected escape directions
- flag pads have enough approach width
- routes have at least two meaningful choices
- no lane violates minimum width
- no protected zone overlaps a tactical slot

If validation fails, repair the blueprint or reroll the topology stream. Do not continue into terrain.

### Stage 3: Allocate Tactical Slots

Walk the route graph and allocate slots with budgets.

Examples:

- primary lane gets hard cover at regular intervals and one major occluder
- flank lane gets softer cover, a turn, and one identity landmark
- midfield gets one contest landmark and two alternate approaches
- base gets spawn shelter, flag pedestal, defender cover, and a clean exit
- elevated route gets explicit access on both sides

Slot placement should use lane-relative coordinates. A slot belongs to a lane, node, edge, or zone.

### Stage 4: Instantiate Modules

Pick modules for slots using compatibility rules.

Module choice should consider:

- slot role
- theme
- map family
- remaining cover budget
- remaining collider budget
- verticality budget
- route graph connectors
- local slope and terrain constraints

Modules must declare connectors. If a module cannot connect to the route graph, reject it before voxel stamping.

### Stage 5: Solve Terrain

Generate a constrained heightfield:

1. Initialize from route, base, flag, spawn, and module pads.
2. Add lane ramps and access corridors.
3. Add boundary wall bands.
4. Blend between constrained surfaces.
5. Add theme landforms and noise inside allowed areas.
6. Run step-limit and slope validation.
7. Emit terrain material fields.

The terrain solver should know which areas must remain playable. Safety sealing should become a validator fallback, not a normal stage.

### Stage 6: Voxelize

Compile terrain and modules into blocks:

- write base terrain layers
- write boundary walls
- write protected pads
- write module blocks
- write team accents
- write natural cover
- write dressing anchors

Each write should carry source metadata in diagnostics. When a voxel causes a validator failure, the report should say whether it came from terrain, a module, boundary, or dressing.

### Stage 7: Validate Compiled Map

Run full validation after voxelization:

- spawn direct sightline audit
- spawn clearance audit
- flag clearance audit
- route graph reachability audit
- movement step audit
- trapped basin and narrow groove audit
- collider count audit
- solid block budget
- chunk count budget
- preview cost estimate
- bot path sampling
- long-sightline histogram
- cover density per lane

If a compiled map fails, prefer semantic repair:

- move or resize slot
- replace module
- increase occluder budget
- adjust lane curve
- smooth terrain in a constrained patch

Voxel-level sealing remains available only as the final safety pass.

### Stage 8: Score And Select

For each seed, generate a small pool of candidate blueprints and keep the best-scoring one.

This is better than accepting the first map and patching it heavily. A seed can still be deterministic: derive candidate sub-seeds from the seed, score each candidate, and pick the stable best.

## Diagnostics Strategy

Diagnostics should become a product, not console trivia.

Every generated map should expose:

- family id
- topology id
- theme id
- generation time by stage
- number of candidate blueprints tried
- score
- failure reasons for rejected candidates
- lane lengths
- lane widths
- route choices
- cover density per lane
- max sightline length
- spawn visibility pairs
- flag approach clearances
- collider count
- chunk count
- solid block count
- module counts by role
- repair actions taken

The smoke script should evolve from "do buildings survive?" into "do maps satisfy gameplay contracts?"

Suggested command targets:

- audit 20 sequential seeds
- audit random seeds
- audit one debug seed with full rejection details
- emit JSON report
- optionally emit small top-down SVG or PNG blueprint previews

No browser verification is required for this plan. Automated generator audits and local type checks are enough for agent-side verification; visual playtests can remain manual.

## Map Vote Strategy

Map vote should not need full voxel generation for every card.

Create a cheap preview artifact from the blueprint:

- family and topology labels
- theme colors
- boundary silhouette
- route graph
- flag/spawn positions
- major landmarks
- preview camera hint

The lobby can show this immediately. Full voxel thumbnail rendering can become optional, cached, or delayed. When a player votes, the card should already communicate meaningful differences such as "split-level frost ring" instead of only a pretty block scene.

## Bot And Gameplay Strategy

Bots and gameplay systems should consume semantic map data.

Bots should receive:

- route graph
- lane labels
- flag routes
- defensive positions
- flank positions
- danger sightline samples
- stuck recovery anchors

Spawn logic should receive:

- spawn clusters
- spawn facing directions
- fallback spawn points
- protected exits

Flag logic should receive:

- flag zone radius
- base approach directions
- return-path hints

Unstuck should receive:

- safe teleport anchors
- lane-relative fallback nodes
- heightfield fallback for nearby terrain

Block sampling remains useful for collision, but it should not be the only navigation API.

## Determinism Rules

Use named RNG streams instead of one shared random stream.

Examples:

- `topology`
- `boundary`
- `bases`
- `lanes`
- `slots`
- `modules`
- `terrain`
- `materials`
- `dressing`
- `diagnostics`

This makes generation stable when one stage changes. Adding a new dressing detail should not silently move flags or lane geometry.

## Migration Plan

### Phase 0: Freeze Current Contracts

Capture current map-generation behavior before replacing it.

Tasks:

1. Extend the existing smoke script to emit JSON.
2. Add audits for generation time, collider count, chunk count, spawn LOS, flag clearance, route clearance, and unsafe groove counts.
3. Store a small known-seed list for regression checks.
4. Add a debug output mode that prints accepted modules, rejected modules, and final metrics.

Exit criteria:

- current generator has repeatable diagnostics for known seeds
- new work can compare against baseline numbers

### Phase 1: Extract A Semantic Layout Layer

Introduce the blueprint types and construct them from the current layout code without changing map output yet.

Tasks:

1. Create design brief and blueprint types.
2. Convert current boundary, flag, spawn, and route concepts into a blueprint.
3. Add route graph and protected-zone metadata to the manifest.
4. Update server and client consumers to prefer semantic fields where possible.

Exit criteria:

- map output remains visually and physically equivalent
- manifest carries explicit gameplay metadata

### Phase 2: Replace Map Vote Preview

Use blueprint previews before full voxel thumbnails.

Tasks:

1. Generate a cheap preview from the blueprint.
2. Add preview camera hints to the manifest or preview payload.
3. Avoid duplicate full-map generation inside map vote cards.
4. Cache full manifests by seed when full rendering is still needed.

Exit criteria:

- map vote no longer requires multiple full voxel builds per option before voting can begin
- each option communicates topology, theme, and major route identity

### Phase 3: Build The Slot System

Add tactical slots and place current structures through slots.

Tasks:

1. Define slot roles and slot constraints.
2. Generate slots from the route graph.
3. Adapt planned buildings to receive slot contracts.
4. Track slot diagnostics and placement failures.
5. Stop trying large numbers of random placements in unsupported areas.

Exit criteria:

- building rejection rate drops significantly
- accepted structures have explicit tactical roles
- rejected structures report slot-level failure reasons

### Phase 4: Introduce Module Grammar

Move map features from one-off stamp functions into module definitions.

Tasks:

1. Create the module interface.
2. Convert a small set of existing features into modules.
3. Give every module connectors, footprint, budget estimate, and local validator.
4. Instantiate modules from tactical slots.

Exit criteria:

- new modules can be added without editing the main generator pipeline
- module placement is visible in diagnostics

### Phase 5: Replace Terrain With Constraint Terrain

Make terrain respect blueprint constraints from the first pass.

Tasks:

1. Build terrain masks from lanes, pads, modules, and protected zones.
2. Generate heightfield from masks and route ramps.
3. Add theme noise only after constraints are satisfied.
4. Reduce repeated spawn/flag clearing passes.
5. Keep existing voxel rendering and collider output.

Exit criteria:

- spawn and flag pads are naturally clear from terrain generation
- route step audits pass before voxel sealing
- terrain has fewer post-generation repair actions

### Phase 6: Candidate Scoring

Generate multiple candidate blueprints per seed and keep the best one.

Tasks:

1. Define map score weights.
2. Generate candidate topology and slot variants from stable sub-seeds.
3. Score candidates before voxelization when possible.
4. Score compiled maps after voxelization.
5. Emit candidate rejection diagnostics.

Exit criteria:

- bad seeds are handled by selection, not heavy patching
- diagnostics explain why the chosen map won

### Phase 7: Retire The Patch Maze

Remove or downgrade old safety patch stages once semantic generation is proven.

Candidates to retire or demote:

- repeated spawn/flag clear and repaint cycles
- direct spawn sightline baffle stamping as normal flow
- broad unsafe groove sealing as normal flow
- fallback building placement as normal flow
- unrestricted cave carving before gameplay validation

Exit criteria:

- final safety passes are rare and reported
- most map validity comes from blueprint, slots, modules, and constrained terrain

## First Vertical Slice

The first implementation should not replace everything.

Build one complete thin slice:

1. Add `MapDesignBrief`, `MapBlueprint`, `RouteGraph`, `TacticalSlot`, and `MapDiagnostics` types.
2. Generate a blueprint from the existing CTF layout.
3. Add blueprint metadata to the current manifest.
4. Add route graph and protected zones to diagnostics.
5. Update the smoke script to print blueprint metrics.
6. Update map vote to use blueprint preview data where possible.
7. Keep voxel output unchanged.

This creates a safe path from current generator to new generator. It also gives the rest of the work somewhere to attach.

## Acceptance Criteria For The New Strategy

- The generator starts from a named map family and topology, not raw feature stamping.
- Every flag, spawn, lane, protected area, and major landmark has semantic metadata.
- Terrain accepts gameplay constraints before noise is applied.
- Structures and landmarks are placed through tactical slots.
- Modules declare connectors, budgets, and validators.
- Spawn and flag clearance are normal constraints, not repeated cleanup passes.
- Spawn-to-spawn line-of-sight prevention happens at blueprint and slot level before voxel baffles.
- Map vote can display useful options without full map rendering.
- Server bots can use route graph metadata instead of only block sampling.
- Diagnostics explain why a seed succeeded or failed.
- Safety repair passes still exist, but their usage is counted and treated as a warning.

## Non-Goals

- Do not add live voxel destruction in this plan. That is covered separately.
- Do not replace the Three.js voxel renderer.
- Do not replace Rapier.
- Do not build a full navmesh system before route graph hints exist.
- Do not make theme skins responsible for gameplay topology.
- Do not add browser-based verification to the agent workflow.

## Implementation Principle

The new generator should feel less like a pile of clever stamps and more like a compiler.

The source program is a CTF blueprint. Modules, terrain, voxels, colliders, previews, and diagnostics are compiled outputs. If a map is bad, fix the source program or the module contract first. Only patch voxels as a last resort.
