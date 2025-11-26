# Voxel Strike - Movement-Based CTF Game

## Tech Stack

| Layer | Technology | Rationale |

|-------|------------|-----------|

| Monorepo | **Turborepo + pnpm** | Fast builds, caching, TypeScript-native |

| 3D Rendering | **Three.js + React Three Fiber** | Mature ecosystem, React integration |

| Physics | **Rapier.js** | WASM-based, fast, deterministic |

| Multiplayer | **Colyseus** | Room-based, state sync, TypeScript-native |

| UI | **React + Tailwind** | Component reuse, rapid styling |

| Build | **Vite** | Fast HMR, native ESM |

## Project Structure

```
opus_strike/
├── apps/
│   ├── client/          # Game client (Vite + React + Three.js)
│   └── server/          # Game server (Colyseus)
├── packages/
│   ├── shared/          # Types, constants, game config
│   ├── physics/         # Rapier physics wrapper, movement logic
│   ├── game-logic/      # Hero definitions, abilities, CTF rules
│   └── assets/          # Voxel models, textures, sounds
├── turbo.json
├── package.json
└── pnpm-workspace.yaml
```

## Core Systems

### 1. Movement System

Shared physics simulation with client-side prediction and server reconciliation:

- **Base movement**: WASD + mouse look, jumping, crouching
- **Parkour**: Wall running (angle detection), sliding, mantling ledges
- **Aerial**: Grappling hook physics, jetpack thrust, gliding drag
- **Abilities**: Dash vectors, blink teleportation with validation

### 2. Hero System (6 Heroes to Start)

Each hero has a passive + 2 abilities + ultimate:

| Hero | Role | Movement Focus | Abilities |

|------|------|----------------|-----------|

| **Phantom** | Flanker | Blink/Teleport | Short blink, shadow step (long teleport), invisibility ult |

| **Hookshot** | Mobile | Grappling | Grapple hook, swing momentum, zipline ult |

| **Blaze** | Assault | Aerial | Jetpack hover, rocket jump, air strike ult |

| **Glacier** | Tank | Parkour | Ice slide, wall climb, frozen fortress ult |

| **Pulse** | Support | Speed | Speed boost aura, dash, team-wide haste ult |

| **Sentinel** | Defense | Grounded | Fortify, knockback resist, shield dome ult |

### 3. CTF Game Mode

- Two bases with flag pedestals
- Flag pickup, carrying (movement penalty), dropping on death
- Score to 3 captures, 10-minute rounds
- Respawn system with spawn protection

### 4. Networking Architecture

```
Client                         Server
  │                              │
  ├─── Input (tick N) ────────► │
  │                              ├─── Validate + Simulate
  │ ◄─── State Snapshot ─────── │
  │                              │
  ├─── Client Prediction ──►    │
  └─── Reconciliation ◄─────────┘
```

- 20 tick server (50ms intervals)
- Client-side prediction with input buffer
- Delta compression for state updates
- Lag compensation for abilities/hits

### 5. Voxel Graphics Style

- Blocky character models (16x16x32 voxel rigs)
- Simple texture atlas (Minecraft-style)
- Stylized lighting with ambient occlusion
- Particle effects for abilities (voxel particles)

## Implementation Phases

### Phase 1: Foundation

- Monorepo setup with Turborepo
- Three.js scene with voxel test map
- Basic first-person controls
- Rapier physics integration

### Phase 2: Movement Core

- Base movement (walk, jump, crouch)
- Parkour system (wall detection, sliding)
- Grappling hook physics
- Dash/blink mechanics

### Phase 3: Multiplayer

- Colyseus server setup
- Room management and matchmaking
- State synchronization
- Client prediction and reconciliation

### Phase 4: Heroes and Abilities

- Hero base class and ability system
- Implement 3 heroes (Phantom, Hookshot, Blaze)
- Cooldown management
- Ability effects and feedback

### Phase 5: CTF Mode

- Flag mechanics (pickup, carry, capture)
- Team spawns and respawn system
- Score tracking and round management
- Win conditions

### Phase 6: Polish

- Remaining 3 heroes
- UI (HUD, scoreboard, hero select)
- Sound effects and music
- Map design tools