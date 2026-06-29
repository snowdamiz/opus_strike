# Slop Heroes

A browser-based 4v4 Capture the Flag game with Minecraft-style voxel graphics and movement-based hero abilities.

## Planning

- [Battle Royal Mode Plan](BATTLE_ROYAL_PLAN.md)
- [Skin NFT Plan](SKIN_NFT_PLAN.md)

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
│   └── physics/         # Rapier physics wrapper, movement logic
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

### Distributed Colyseus Development

Local distributed mode uses Redis for Colyseus presence, room discovery, seat reservations, and lightweight wager notifications.

```bash
pnpm db:up
pnpm db:migrate

# terminal 1
pnpm dev:server:distributed:a

# terminal 2
pnpm dev:server:distributed:b

# optional Node-only verification harness
pnpm --filter @voxel-strike/server harness:colyseus-distributed
```

Required production variables for a single direct-address deployment:

- `COLYSEUS_DISTRIBUTED=1`
- `COLYSEUS_REDIS_URL` or `REDIS_URL`
- `COLYSEUS_PUBLIC_ADDRESS`, when each room-owning process has a stable direct address
- `COLYSEUS_REQUIRE_PUBLIC_ADDRESS=1`, to fail fast if routing depends on direct process addresses

Fly production uses Fly managed Upstash Redis plus `fly-replay` routing so multiple Machines can share the normal app hostname:

```bash
# Create the managed Redis database in the same region as the server app.
fly redis create --name opus-strike-redis --region iad --no-replicas

# Copy the Private URL from this status output.
fly redis status opus-strike-redis

# Store the private Redis URL as a server secret. Do not put it in fly.toml.
fly secrets set -a opus-strike-server COLYSEUS_REDIS_URL='<private redis URL>'

# Deploy the server and then run at least two Machines.
fly deploy -a opus-strike-server --config apps/server/fly.toml
fly scale count 2 -a opus-strike-server
```

The checked-in `apps/server/fly.toml` enables:

- `COLYSEUS_DISTRIBUTED=1`
- `COLYSEUS_ROUTING_STRATEGY=fly_replay`
- `COLYSEUS_PUBLIC_ADDRESS=opus-strike-server.fly.dev`
- `COLYSEUS_REQUIRE_PUBLIC_ADDRESS=1`

Fly provides `FLY_APP_NAME`, `FLY_MACHINE_ID`, and `FLY_REGION` at runtime. Each server process registers its Colyseus `processId` to `FLY_MACHINE_ID` in Redis with a heartbeat. WebSocket joins to a room owned by another process return `fly-replay: instance=<machine id>` before the upgrade, so the Fly proxy routes the connection to the room-owning Machine. `/health` reports Redis, distributed matchmaking, and Fly replay registration status.

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

### Ranked Token Hold

Ranked matchmaking verifies that the linked wallet holds the configured token value before issuing a ranked ticket. Native SOL uses the wallet lamport balance; SPL-token addresses use token accounts for that mint.

Server environment:

- `RANKED_TOKEN_HOLD_ENABLED`: enable the gate. Default: `true`.
- `RANKED_TOKEN_HOLD_TOKEN_ADDRESS`: ranked access token address. Default: `So11111111111111111111111111111111111111112` (native SOL).
- `RANKED_TOKEN_HOLD_TOKEN_SYMBOL`: ticker shown in ranked UI. Default: `SOL` for native SOL, otherwise `TOKEN`.
- `RANKED_TOKEN_HOLD_USD_CENTS`: required USD value in cents. Default: `2000` (`$20`).
- `RANKED_TOKEN_HOLD_RPC_URL`: RPC URL for ranked hold checks. Falls back to `SOLANA_RPC_URL`.
- `SOLANA_CLUSTER`: cluster label returned to clients. Default: `mainnet-beta`.
- `RANKED_TOKEN_HOLD_PRICE_SOURCE`: `coingecko` or `env`. Default: `coingecko`.
- `RANKED_TOKEN_HOLD_TOKEN_USD_PRICE` or `RANKED_TOKEN_HOLD_TOKEN_USD_MICRO_USD`: required when `RANKED_TOKEN_HOLD_PRICE_SOURCE=env`.
- `RANKED_TOKEN_HOLD_PRICE_STALE_MS`: price cache window. Default: `60000`.
- `RANKED_TOKEN_HOLD_RPC_TIMEOUT_MS`: balance RPC timeout. Default: `5000`.

### Game Token And Skin NFTs

Paid skins use the global game SPL token for payment. When `SKIN_NFT_COLLECTION_ADDRESS` is configured, paid skin delivery becomes NFT-backed: the server verifies the token payment, mints a Metaplex Core asset to the linked wallet, and caches wallet-asset ownership for fast loadout checks.

Server environment:

- `GAME_TOKEN_MINT`: global SPL token mint used by ranked gates, skin payments, and future token-gated systems.
- `GAME_TOKEN_SYMBOL`: ticker shown in the UI.
- `SOLANA_RPC_URL`: RPC used for token payments, minting, and wallet checks.
- `SOLANA_CLUSTER`: cluster label returned to clients. Default: `mainnet-beta`.
- `WAGER_TREASURY_WALLET`: treasury wallet that receives skin payments.
- `SKIN_NFT_ENABLED`: override NFT mode on/off. Defaults on when `SKIN_NFT_COLLECTION_ADDRESS` is present.
- `SKIN_NFT_COLLECTION_ADDRESS`: verified Metaplex Core collection for Opus Strike skins.
- `SKIN_NFT_MINT_AUTHORITY_PUBLIC_KEY`: public mint authority address shown in diagnostics.
- `SKIN_NFT_MINT_AUTHORITY_SECRET_KEY`: JSON byte array, comma bytes, or base58 secret used by the server to mint Core assets. Store as a secret.
- `SKIN_NFT_METADATA_BASE_URI`: base URI used as `<base>/<skinId>.json`.
- `SKIN_NFT_METADATA_URI_TEMPLATE`: optional template with `{skinId}`, `{heroId}`, `{rarity}`, and `{edition}` placeholders.
- `SKIN_NFT_DAS_RPC_URL`: DAS-capable RPC for wallet ownership sync. Falls back to `SOLANA_RPC_URL`.
- `SKIN_NFT_SYNC_CACHE_MS`: catalog-load sync cache window. Default: `60000`.
- `SKIN_NFT_EDITION`: metadata edition attribute. Default: `genesis`.
- `SKIN_NFT_FOUNDER_ENABLED`: enables founder/unlockable NFT behavior. Default: `false`.

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
| Crouch | C |
| Sprint | Left Shift |
| Ability 1 | E |
| Ability 2 | Q |
| Ultimate | F |
| Reload | R |
| Interact | X |
| Scoreboard | Tab |

## License

MIT
