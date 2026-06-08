# Slop Heroes

A browser-based 4v4 Capture the Flag game with Minecraft-style voxel graphics and movement-based hero abilities.

## Features

- **4 Unique Heroes** with distinct movement abilities:
  - **Phantom** (Flanker) - Blink teleportation, Shadow Step, Invisibility
  - **Hookshot** (Mobile) - Grappling hook, Swing mechanics, Zipline ultimate
  - **Blaze** (Assault) - Flamethrower, Rocket jump, Air strike ultimate
  - **Glacier** (Tank) - Ice slide, Wall climb, Frozen fortress

- **Advanced Movement System**:
  - Wall running with momentum
  - Sliding mechanics
  - Ledge mantling
  - Grappling hook physics
  - Flamethrower fuel management
  - Gliding

- **Capture the Flag Mode**:
  - 4v4 team battles
  - Flag pickup, carry, and capture mechanics
  - Score-to-win gameplay
  - Spawn protection

- **Voxel Graphics**:
  - Minecraft-inspired blocky aesthetic
  - Dynamic lighting and shadows
  - Particle effects for abilities

## Tech Stack

| Layer | Technology |
|-------|------------|
| Monorepo | Turborepo + pnpm |
| 3D Rendering | Three.js + React Three Fiber |
| Physics | Rapier.js |
| Multiplayer | Colyseus |
| UI | React + Tailwind CSS |
| Build | Vite |

## Project Structure

```
voxel-strike/
├── apps/
│   ├── client/          # Game client (Vite + React + Three.js)
│   └── server/          # Game server (Colyseus)
├── packages/
│   ├── shared/          # Types, constants, game config
│   ├── physics/         # Rapier physics wrapper, movement logic
│   └── game-logic/      # Hero definitions, abilities, CTF rules
├── turbo.json
├── package.json
└── pnpm-workspace.yaml
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 9+

### Installation

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm run build
```

### Development

```bash
# Start both client and server in development mode
pnpm run dev

# Or start individually:
pnpm run dev:client  # Start client on http://localhost:3000
pnpm run dev:server  # Start server on ws://localhost:2567
```

### Playing

1. Start the server: `pnpm run dev:server`
2. Start the client: `pnpm run dev:client`
3. Open http://localhost:3000 in your browser
4. Enter a player name and click "JOIN GAME"
5. Select a hero and wait for another player to join
6. Use WASD to move, Space to jump, and mouse to look around
7. Capture the enemy flag and return it to your base to score!

## Controls

| Action | Key |
|--------|-----|
| Move | WASD |
| Jump | Space |
| Crouch | Left Ctrl |
| Sprint | Left Shift |
| Ability 1 | E |
| Ability 2 | Q |
| Ultimate | F |
| Interact | R |
| Scoreboard | Tab |

## License

MIT
