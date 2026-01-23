# Requirements: Opus Strike CTF Map

**Defined:** 2026-01-22
**Core Value:** A fully playable asymmetrical CTF map with proper collision, spawn points, and flag zones that integrates seamlessly with the existing game systems.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Map Foundation

- [x] **FOUND-01**: Remove current imported map from game world
- [x] **FOUND-02**: Create asymmetrical map layout with visually distinct team sides
- [x] **FOUND-03**: Establish three main attack routes connecting team bases
- [x] **FOUND-04**: Balance travel times between routes (no route significantly faster)

### Team Areas

- [ ] **TEAM-01**: Build Team A base area with distinct visual identity
- [ ] **TEAM-02**: Build Team B base area with distinct visual identity
- [ ] **TEAM-03**: Configure spawn points for Team A (multiple positions)
- [ ] **TEAM-04**: Configure spawn points for Team B (multiple positions)
- [ ] **TEAM-05**: Create flag zone for Team A with 2-3 entry points
- [ ] **TEAM-06**: Create flag zone for Team B with 2-3 entry points
- [ ] **TEAM-07**: Integrate flag zones with FlagManager and CTFGameMode

### Cover & Engagement

- [ ] **COVR-01**: Place hard cover elements (walls, barriers) along routes
- [ ] **COVR-02**: Define 2-3 choke points for team fight engagement
- [ ] **COVR-03**: Create mixed sightlines (short, medium, long range options)
- [ ] **COVR-04**: Add elevated positions with height advantage
- [ ] **COVR-05**: Build ramps/stairs for vertical navigation

### Environment Elements

- [ ] **ENVR-01**: Create building structures (solid, provide cover/routing)
- [ ] **ENVR-02**: Add trees/foliage for decoration and concealment
- [ ] **ENVR-03**: Place props (barrels, crates) for small cover and detail

### Technical Integration

- [ ] **TECH-01**: Generate collision meshes for all walkable surfaces
- [ ] **TECH-02**: Generate collision meshes for all blocking surfaces (walls, buildings)
- [ ] **TECH-03**: Register collision meshes with Rapier physics world
- [ ] **TECH-04**: Integrate spawn positions with SpawnManager
- [ ] **TECH-05**: Use instanced rendering for repeated props (performance optimization)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Features

- **ADV-01**: Hero-specific shortcuts (grapple points, teleport spots)
- **ADV-02**: Competitive lighting optimization (clear visibility, no dark corners)
- **ADV-03**: Collision layer separation (players, projectiles, triggers)
- **ADV-04**: Debug visualization toggle for testing

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Destructible/interactive elements | Adds complexity without testing value |
| Multiple map variants | Single map sufficient for testing |
| Map editor/tools | Manual construction is fine for one map |
| Complex textures/materials | Low-poly aesthetic uses simple materials |
| Dynamic lighting | Performance overhead, not needed for testing |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Complete |
| TEAM-01 | Phase 2 | Pending |
| TEAM-02 | Phase 2 | Pending |
| TEAM-03 | Phase 2 | Pending |
| TEAM-04 | Phase 2 | Pending |
| TEAM-05 | Phase 2 | Pending |
| TEAM-06 | Phase 2 | Pending |
| TEAM-07 | Phase 2 | Pending |
| COVR-01 | Phase 3 | Pending |
| COVR-02 | Phase 3 | Pending |
| COVR-03 | Phase 3 | Pending |
| COVR-04 | Phase 3 | Pending |
| COVR-05 | Phase 3 | Pending |
| ENVR-01 | Phase 3 | Pending |
| ENVR-02 | Phase 4 | Pending |
| ENVR-03 | Phase 4 | Pending |
| TECH-01 | Phase 5 | Pending |
| TECH-02 | Phase 5 | Pending |
| TECH-03 | Phase 5 | Pending |
| TECH-04 | Phase 5 | Pending |
| TECH-05 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0

---
*Requirements defined: 2026-01-22*
*Last updated: 2026-01-22 - Phase 1 requirements complete*
