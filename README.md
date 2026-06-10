# Slop Heroes

A browser-based 4v4 Capture the Flag game with Minecraft-style voxel graphics and movement-based hero abilities.

## Features

- **3 Unique Heroes** with distinct movement abilities:
  - **Phantom** (Flanker) - Blink teleportation, Shadow Step, Invisibility
  - **Hookshot** (Mobile) - Grappling hook, Swing mechanics, Zipline ultimate
  - **Blaze** (Assault) - Flamethrower, Rocket jump, Infernal Gearstorm ultimate

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

### Voice Chat

Team voice uses LiveKit through backend-issued, short-lived room tokens. For local development, start the bundled LiveKit service and set the server environment:

```bash
docker compose up postgres livekit
VOICE_ENABLED=true \
LIVEKIT_URL=http://localhost:7880 \
LIVEKIT_WS_URL=ws://localhost:7880 \
LIVEKIT_API_KEY=devkey \
LIVEKIT_API_SECRET=secret \
pnpm dev:server
```

Optional production knobs:

- `VOICE_TOKEN_TTL_SECONDS`: token lifetime in seconds, clamped between 60 and 3600. Default: `600`.
- `VOICE_ENV`: room-name environment segment. Defaults to `NODE_ENV` or `development`.
- `VOICE_MAX_PARTICIPANTS_PER_ROOM`: LiveKit team-room cap. Default: `8`.

`GET /voice/status` reports whether voice is enabled and why it is disabled without exposing LiveKit secrets.

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
