# Phase 2: Team Base Construction - Research

**Researched:** 2026-01-22
**Domain:** Team base spawn integration, flag zone systems, CTF game mode integration
**Confidence:** HIGH

## Summary

Phase 2 builds on the map foundation from Phase 1 to complete team bases with functional spawns and flag zones. The key discovery is that most visual geometry already exists (TeamABase.tsx and TeamBBase.tsx from Phase 1) - this phase focuses on integrating that geometry with game systems rather than building new visual elements.

The architecture consists of three integration points: (1) MAP_CONFIG must export spawn positions and flag zone positions, (2) the server's MatchManager must use these positions when initializing FlagManager and SpawnManager, and (3) the client must render flag indicators at the correct positions from gameStore. The user's CONTEXT.md decisions constrain implementation to distributed spawns, semi-protected areas, equal-access flag zones, and manual flag return only.

**Primary recommendation:** Extend MAP_CONFIG with explicit spawn point arrays and flag zone positions. Create a SpawnConfig type that matches what SpawnManager expects. Update MatchManager to import from shared map config rather than hardcoding positions. Add visual spawn indicators (floor texture/glow) and flag zone contested-state effects to the existing base geometry components.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @react-three/fiber | 8.17 | React renderer for Three.js | Already in project, handles all visual rendering |
| zustand | 4.x | State management | gameStore already syncs flag/spawn state from server |
| @voxel-strike/game-logic | local | CTF game mode, FlagManager, SpawnManager | Existing package with all game systems |
| @voxel-strike/shared | local | Vec3, Team types, game constants | Shared types between client/server |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @react-three/drei | 9.114 | Helper components (Grid, Float) | Already used for Grid floor; Pulsing effects |
| three | 0.169 | THREE.MeshStandardMaterial | Emissive materials for contested state |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hardcoded spawn positions | Config-driven positions | Config is better for maintainability |
| Per-frame flag position check | gameStore subscription | Store subscription is React-idiomatic |
| Custom spawn indicator | Drei Float/Pulsing | Drei components are simpler |

**Installation:**
```bash
# No new packages required - all dependencies already in project
```

## Architecture Patterns

### Recommended Project Structure
```
apps/client/src/components/game/
├── maps/sci-fi-ctf/
│   ├── config.ts              # Add spawnPoints and flagPositions
│   ├── geometry/
│   │   ├── TeamABase.tsx      # Add spawn indicators, enhance flag zone
│   │   ├── TeamBBase.tsx      # Add spawn indicators, enhance flag zone
│   │   ├── FlagZone.tsx       # NEW: Shared flag zone component with effects
│   │   └── SpawnIndicator.tsx # NEW: Shared spawn point indicator component
│   └── ...
├── Flags.tsx                   # Already exists, may need enhancements
└── ...

packages/game-logic/src/
├── match/
│   ├── SpawnManager.ts        # Already exists - may need setSpawnPoints usage
│   └── MatchManager.ts        # UPDATE: Import positions from config
└── ctf/
    ├── FlagManager.ts         # Already exists - no changes needed
    └── CTFGameMode.ts         # Already exists - no changes needed
```

### Pattern 1: Centralized Position Configuration
**What:** Define all gameplay positions (spawns, flags) in one config file
**When to use:** Always - prevents position drift between visual and game systems
**Example:**
```typescript
// config.ts - extend existing MAP_CONFIG
export const MAP_CONFIG = {
  // ... existing dimensions, teamABase, teamBBase ...

  // Spawn positions - distributed across base area
  spawnPoints: {
    teamA: [
      { x: -75, y: 1, z: -8 },   // North spawn
      { x: -75, y: 1, z: 0 },    // Center spawn
      { x: -75, y: 1, z: 8 },    // South spawn
      { x: -80, y: 1, z: -5 },   // Back-left spawn
      { x: -80, y: 1, z: 5 },    // Back-right spawn
    ],
    teamB: [
      { x: 75, y: 1, z: -8 },
      { x: 75, y: 1, z: 0 },
      { x: 75, y: 1, z: 8 },
      { x: 80, y: 1, z: -5 },
      { x: 80, y: 1, z: 5 },
    ],
  },

  // Flag zone positions - on raised platforms at y=1
  flagZones: {
    teamA: { x: -90, y: 1, z: 0 },  // Back of Team A base
    teamB: { x: 90, y: 1, z: 0 },   // Back of Team B base
  },
} as const;
```

### Pattern 2: Visual Spawn Indicators
**What:** Subtle floor markers showing spawn positions
**When to use:** User decision - "subtle spawn indicators"
**Example:**
```typescript
// SpawnIndicator.tsx
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface SpawnIndicatorProps {
  position: [number, number, number];
  team: 'red' | 'blue';
}

// Shared materials for performance
const teamAIndicator = new THREE.MeshStandardMaterial({
  color: 0x1a0a0a,
  emissive: 0xff4400,
  emissiveIntensity: 0.3,
  transparent: true,
  opacity: 0.6,
});

const teamBIndicator = new THREE.MeshStandardMaterial({
  color: 0x0a0a1a,
  emissive: 0x00ccff,
  emissiveIntensity: 0.3,
  transparent: true,
  opacity: 0.6,
});

export function SpawnIndicator({ position, team }: SpawnIndicatorProps) {
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (ringRef.current) {
      // Subtle pulse animation
      const pulse = 0.3 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
      (ringRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
    }
  });

  return (
    <mesh
      ref={ringRef}
      position={[position[0], position[1] + 0.02, position[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={team === 'red' ? teamAIndicator : teamBIndicator}
    >
      <ringGeometry args={[0.8, 1.2, 32]} />
    </mesh>
  );
}
```

### Pattern 3: Contested Flag Zone Effects
**What:** Visual feedback when enemies are near flag zone
**When to use:** User decision - "warning indicators when contested"
**Example:**
```typescript
// FlagZone.tsx - enhanced flag zone with contested state
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../../../store/gameStore';

interface FlagZoneProps {
  position: [number, number, number];
  team: 'red' | 'blue';
}

export function FlagZone({ position, team }: FlagZoneProps) {
  const ringRef = useRef<THREE.Mesh>(null);
  const players = useGameStore((s) => s.players);

  // Check if any enemy player is within contest radius
  const isContested = useMemo(() => {
    const contestRadius = 15; // Units
    for (const player of players.values()) {
      if (player.team !== team && player.isAlive) {
        const dx = player.position.x - position[0];
        const dz = player.position.z - position[2];
        if (dx * dx + dz * dz < contestRadius * contestRadius) {
          return true;
        }
      }
    }
    return false;
  }, [players, team, position]);

  useFrame((state) => {
    if (ringRef.current) {
      const mat = ringRef.current.material as THREE.MeshStandardMaterial;
      if (isContested) {
        // Fast pulse when contested
        mat.emissiveIntensity = 1.0 + Math.sin(state.clock.elapsedTime * 6) * 0.5;
      } else {
        // Slow gentle pulse when safe
        mat.emissiveIntensity = 0.5 + Math.sin(state.clock.elapsedTime * 1.5) * 0.2;
      }
    }
  });

  // ... render flag zone ring and platform edge markers
}
```

### Pattern 4: Server-Side Position Configuration
**What:** MatchManager imports spawn/flag positions from shared config
**When to use:** When integrating map config with game systems
**Example:**
```typescript
// MatchManager.ts - update initialize method
import { MAP_CONFIG } from '@voxel-strike/client/maps/sci-fi-ctf/config';
// OR create a shared map config package

initialize(): void {
  // Use configured spawn points
  this.spawnManager.setSpawnPoints('red', MAP_CONFIG.spawnPoints.teamA);
  this.spawnManager.setSpawnPoints('blue', MAP_CONFIG.spawnPoints.teamB);

  // Initialize CTF with configured flag positions
  this.ctfMode.initialize(
    MAP_CONFIG.flagZones.teamA,
    MAP_CONFIG.flagZones.teamB
  );
}
```

### Anti-Patterns to Avoid
- **Hardcoding positions in MatchManager:** Current initialize() uses hardcoded positions - centralize in config
- **Separate visual and game positions:** If flag visual is at x=90 but game thinks it's at x=40, players will be confused
- **Checking players every frame for contested state:** Use useMemo with dependency on players Map
- **Creating new materials in render:** Spawn indicators should share material instances

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Flag rendering | Custom flag component | Existing `Flags.tsx` | Already handles all flag states |
| Spawn rotation | Custom rotation logic | SpawnManager.getSpawnPoint() | Already includes random offset |
| Flag pickup detection | Custom distance check | CTFGameMode.checkFlagPickup() | Uses FLAG_PICKUP_RADIUS constant |
| Flag state sync | Custom networking | gameStore.redFlag/blueFlag | Already synced from server |
| Material glow effects | Custom shader | MeshStandardMaterial.emissive | Built-in, performant |

**Key insight:** The game systems (FlagManager, SpawnManager, CTFGameMode) are complete and working. This phase is about connecting visual geometry to those systems via configuration, not reimplementing game logic.

## Common Pitfalls

### Pitfall 1: Position Coordinate Mismatch
**What goes wrong:** Flag appears in wrong location, players can't capture
**Why it happens:** Client uses one coordinate system, server uses another; or visual uses local coordinates while game uses world coordinates
**How to avoid:**
- Define positions in MAP_CONFIG in world coordinates
- Import same config on both client and server
- Visual geometry should use `position` prop, not transform parent groups that offset
**Warning signs:** Flag renders in correct location but capture radius feels off

### Pitfall 2: Spawn Y-Coordinate Too Low
**What goes wrong:** Players spawn inside floor or fall through map
**Why it happens:** Spawn y=0 but floor surface is at y=0.5, or platform is elevated
**How to avoid:**
- Set spawn Y to be 1 unit above floor surface (player center is ~0.9 above feet)
- Test spawning on elevated flag platforms specifically
- Use checkGroundWithNormal() to validate spawn positions if needed
**Warning signs:** Players take damage on spawn, or camera clips through floor

### Pitfall 3: Ignoring SpawnManager.setSpawnPoints()
**What goes wrong:** SpawnManager.initialize() generates automatic positions, ignoring config
**Why it happens:** initialize() always regenerates spawn points from base position
**How to avoid:**
- Call setSpawnPoints() AFTER initialize(), or modify initialize() to skip auto-generation
- Or: modify SpawnManager to accept explicit positions in constructor/initialize
**Warning signs:** Players spawn in default pattern (4 corners + center) despite config

### Pitfall 4: Flag Zone Entry Point Asymmetry
**What goes wrong:** One team's flag is easier to grab than the other
**Why it happens:** Team A has 3 entry points with equal cover, Team B has 2 or unequal cover
**How to avoid:**
- Document entry points explicitly for each flag zone
- Ensure similar approach distances and cover availability
- Test flag grabs from each approach direction
**Warning signs:** One team captures flags more often in playtests

### Pitfall 5: Missing Physics Colliders for Spawn Platforms
**What goes wrong:** Players spawn and immediately fall through floor
**Why it happens:** Visual geometry exists but MapColliders.ts doesn't cover spawn areas
**How to avoid:**
- Review MapColliders.ts to ensure all spawn positions have floor colliders beneath them
- Test each spawn point individually with debug logging
**Warning signs:** Some spawns work, others result in falling

## Code Examples

Verified patterns from existing codebase:

### Accessing Flag State from Client
```typescript
// From gameStore.ts - already exists
const { redFlag, blueFlag } = useGameStore();

// Flag structure:
interface FlagState {
  position: Vec3;
  carrierId: string | null;
  isAtBase: boolean;
}
```

### SpawnManager Interface
```typescript
// From SpawnManager.ts - setSpawnPoints already exists
setSpawnPoints(team: Team, points: Vec3[]): void {
  if (team === 'red') {
    this.redSpawnPoints = points;
  } else {
    this.blueSpawnPoints = points;
  }
}

// Spawn point retrieval rotates through positions
getSpawnPoint(team: Team): Vec3 {
  // Returns spawn with small random offset
}
```

### FlagManager Initialization
```typescript
// From FlagManager.ts - initialize already exists
initialize(redBase: Vec3, blueBase: Vec3): void {
  this.redFlag = {
    team: 'red',
    state: 'at_base',
    position: { ...redBase },
    basePosition: { ...redBase },
    carrierId: null,
    droppedAt: null,
  };
  // Same for blueFlag
}
```

### Existing Flag Component Reference
```typescript
// From Flags.tsx - already handles rendering
function Flag({ position, team, isAtBase }: FlagProps) {
  // Pole, cloth with wave animation, base glow, pickup ring
  // Vertical beam when dropped
  // Floating animation when at base
}
```

### Existing Material Pattern
```typescript
// From materials.ts - Team A glow example
export const teamAGlow = new THREE.MeshStandardMaterial({
  color: 0x1a0a0a,
  emissive: 0xff6600,
  emissiveIntensity: 1.2,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded spawn/flag positions | Config-driven positions | This phase | Maintainability, single source of truth |
| Auto-generated spawn pattern | Explicit spawn array | This phase | Control over spawn distribution |
| Static flag zone | Contested-aware effects | This phase | Player feedback, situational awareness |

**Deprecated/outdated:**
- MatchManager.initialize() hardcoding positions: Will be replaced with config import
- SpawnManager.generateSpawnPoints(): May be bypassed with setSpawnPoints()

## Open Questions

Things that couldn't be fully resolved:

1. **Shared Config Package vs Import Path**
   - What we know: Client has config.ts with MAP_CONFIG; server needs same positions
   - What's unclear: Best way to share config between monorepo packages
   - Recommendation: Create minimal shared map config in @voxel-strike/shared, or duplicate positions (simple but requires sync)

2. **Spawn Protection Visual Indicator**
   - What we know: Server has spawnProtectionSeconds config (3 seconds)
   - What's unclear: Should spawn indicator show protection state visually?
   - Recommendation: Out of scope for Phase 2 - focus on positions first, add effects later

3. **Flag Carrier Outline/Icon**
   - What we know: User decided "visible carrier marker"
   - What's unclear: Whether this is client-side (shader/outline) or UI overlay
   - Recommendation: Defer to Phase 2 planning - may require separate task for player rendering changes

4. **Dramatic Flag Pickup Effects**
   - What we know: User decided "flash, particle burst, sound"
   - What's unclear: Particle system approach (existing effects? new system?)
   - Recommendation: Research existing effect patterns in codebase (BlazeEffects, PhantomEffects)

## Sources

### Primary (HIGH confidence)
- `/apps/client/src/components/game/maps/sci-fi-ctf/config.ts` - Existing MAP_CONFIG structure
- `/apps/client/src/components/game/maps/sci-fi-ctf/geometry/TeamABase.tsx` - Existing base geometry
- `/apps/client/src/components/game/maps/sci-fi-ctf/geometry/TeamBBase.tsx` - Existing base geometry
- `/packages/game-logic/src/match/SpawnManager.ts` - SpawnManager interface
- `/packages/game-logic/src/match/MatchManager.ts` - Current hardcoded positions
- `/packages/game-logic/src/ctf/FlagManager.ts` - FlagManager interface
- `/packages/game-logic/src/ctf/CTFGameMode.ts` - CTF game logic
- `/apps/client/src/components/game/Flags.tsx` - Existing flag rendering
- `/apps/client/src/store/gameStore.ts` - Flag state sync from server
- `/packages/shared/src/constants/game.ts` - FLAG_PICKUP_RADIUS, FLAG_CAPTURE_RADIUS

### Secondary (MEDIUM confidence)
- `/apps/client/src/components/game/maps/sci-fi-ctf/materials.ts` - Material patterns
- `/apps/client/src/components/game/maps/sci-fi-ctf/colliders/MapColliders.ts` - Physics collider patterns
- `.planning/phases/02-team-base-construction/02-CONTEXT.md` - User decisions

### Tertiary (LOW confidence)
- Effect patterns in `/apps/client/src/components/game/` subdirectories - May inform pickup effects

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Uses existing project dependencies
- Architecture: HIGH - Based on existing codebase patterns and game system interfaces
- Pitfalls: HIGH - Derived from code analysis of existing systems
- Integration points: HIGH - Verified from actual source code

**Research date:** 2026-01-22
**Valid until:** 60 days (stable domain, internal codebase patterns)
