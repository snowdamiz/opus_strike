# Roadmap: Opus Strike CTF Map

## Overview

This roadmap delivers a custom asymmetrical CTF arena for Opus Strike in five phases. We start by establishing the map foundation and route structure, then build team-specific areas with spawns and flag zones, add cover elements and verticality for tactical gameplay, polish with decorative elements, and finally integrate physics collision and performance optimizations. Each phase produces a testable increment toward a fully playable competitive map.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Map Foundation** - Remove old map, create asymmetrical layout with three attack routes
- [ ] **Phase 2: Team Base Construction** - Build both team bases with spawns, flag zones, and game system integration
- [ ] **Phase 3: Combat Routes & Cover** - Add cover elements, choke points, sightlines, buildings, and vertical positions
- [ ] **Phase 4: Environment Decoration** - Add trees, foliage, props for visual polish and concealment
- [ ] **Phase 5: Physics & Performance** - Generate collision meshes, integrate with Rapier, optimize with instancing

## Phase Details

### Phase 1: Map Foundation
**Goal**: Establish the playable arena with clear asymmetrical layout and three distinct routes between team sides
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04
**Success Criteria** (what must be TRUE):
  1. Imported map no longer appears in game world
  2. Ground plane exists with visually distinct Team A and Team B sides
  3. Three navigable paths connect the two sides (even if just floor geometry)
  4. Walking each route takes approximately equal time (within 20% variance)
**Plans**: 5 plans in 3 waves

Plans:
- [ ] 01-01-PLAN.md - Remove old GLB map, scaffold structure, create materials (Wave 1)
- [ ] 01-02-PLAN.md - Team A base geometry (tech/platform aesthetic) (Wave 2)
- [ ] 01-03-PLAN.md - Team B base geometry (natural/cave aesthetic) (Wave 2)
- [ ] 01-04-PLAN.md - Center zone, routes, interconnects, hazards (Wave 2)
- [ ] 01-05-PLAN.md - Boundary walls, mapBoundaries update, physics colliders (Wave 3)

### Phase 2: Team Base Construction
**Goal**: Both teams have complete, functional base areas with spawn points and flag capture zones integrated with game systems
**Depends on**: Phase 1
**Requirements**: TEAM-01, TEAM-02, TEAM-03, TEAM-04, TEAM-05, TEAM-06, TEAM-07
**Success Criteria** (what must be TRUE):
  1. Team A base has distinct visual identity (color, shape, or landmarks)
  2. Team B base has distinct visual identity (different from Team A)
  3. Players spawn at configured positions within their team's base area
  4. Flag zones are visible with game objects and have 2-3 entry points each
  5. Capturing a flag triggers correct game state updates (FlagManager/CTFGameMode)
**Plans**: TBD

Plans:
- [ ] 02-01: TBD

### Phase 3: Combat Routes & Cover
**Goal**: Routes between bases provide tactical gameplay with cover options, engagement choke points, and vertical positions
**Depends on**: Phase 2
**Requirements**: COVR-01, COVR-02, COVR-03, COVR-04, COVR-05, ENVR-01
**Success Criteria** (what must be TRUE):
  1. Each route has hard cover elements (walls, barriers) players can use to break line of sight
  2. At least 2 choke points exist where teams naturally engage
  3. Players can choose short, medium, or long-range engagement positions
  4. At least 2 elevated positions provide height advantage
  5. All elevated positions are reachable via ramps or stairs (no jump-only)
**Plans**: TBD

Plans:
- [ ] 03-01: TBD

### Phase 4: Environment Decoration
**Goal**: Map has visual polish with decorative elements that add atmosphere and gameplay-relevant concealment
**Depends on**: Phase 3
**Requirements**: ENVR-02, ENVR-03
**Success Criteria** (what must be TRUE):
  1. Trees and foliage appear in appropriate areas (not blocking critical sightlines)
  2. Props (barrels, crates) provide small cover and visual detail throughout map
  3. Decorative elements maintain low-poly aesthetic consistent with game style
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

### Phase 5: Physics & Performance
**Goal**: All map geometry has proper collision detection and performance is optimized for multiplayer
**Depends on**: Phase 4
**Requirements**: TECH-01, TECH-02, TECH-03, TECH-04, TECH-05
**Success Criteria** (what must be TRUE):
  1. Players cannot walk through walls, buildings, or solid cover
  2. Players can walk on all intended surfaces (floors, ramps, platforms)
  3. SpawnManager spawns players at configured positions without clipping into geometry
  4. Repeated props (crates, barrels, trees) use instanced rendering
  5. Frame rate stays stable during multiplayer gameplay (no physics-induced drops)
**Plans**: TBD

Plans:
- [ ] 05-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Map Foundation | 0/5 | Planned | - |
| 2. Team Base Construction | 0/? | Not started | - |
| 3. Combat Routes & Cover | 0/? | Not started | - |
| 4. Environment Decoration | 0/? | Not started | - |
| 5. Physics & Performance | 0/? | Not started | - |

---
*Roadmap created: 2026-01-22*
*Last updated: 2026-01-22*
