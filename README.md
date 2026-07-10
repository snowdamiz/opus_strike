# Slop Heroes

A browser-based 4v4 Capture the Flag game with Minecraft-style voxel graphics and movement-based hero abilities.

## Planning

- [Battle Royal Mode Plan](BATTLE_ROYAL_PLAN.md)
- [Pregenerated Map Pool Plan](PREGENERATED_MAP_POOL_PLAN.md)
- [Server Action Replay Recording Plan](SERVER_ACTION_REPLAY_RECORDING_PLAN.md)

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
# Build/start the local Docker server cluster, run migrations, and launch the client.
# Server dev uses Redis-backed distributed Colyseus plus map-pool auto top-up.
pnpm run dev

# Or start individually:
pnpm run dev:client  # Start client on http://localhost:3000
pnpm run dev:server  # Start the Docker server cluster and tail its logs
```

### Distributed Colyseus Development

Local server development is Docker-backed and Redis-backed by default so it stays close to production. `pnpm dev` starts Postgres, Redis, and five server containers: three US machines (`server-us-1..3`) plus one Europe and one Asia machine. `server-us-1` is exposed at `ws://localhost:2567` for the client; the other machines are exposed at ports `2568` through `2571` so Colyseus direct seat reservations can connect to the room-owning process.

`pnpm dev`, `pnpm dev:server`, and `pnpm db:up` run a Docker readiness preflight before calling Compose. On macOS, if Docker Desktop is installed but closed, the preflight opens it and waits up to 120 seconds by default before continuing. Override that wait with `DOCKER_START_TIMEOUT_MS`, or set `DOCKER_AUTO_START=0` to require Docker to be started manually.

```bash
# start or rebuild just the server cluster
pnpm dev:server:cluster:up

# tail server logs
pnpm dev:server:cluster:logs

# tail Redis and Postgres logs when debugging infrastructure
pnpm dev:server:cluster:infra-logs

# explicit single-process fallback for narrow debugging only
pnpm dev:server:local

# optional Node-only verification harness
pnpm --filter @voxel-strike/server harness:colyseus-distributed
```

With Redis configured in development, the pregenerated map pool top-up worker is enabled by default. Each server reports its local room/load snapshot to Redis; the worker picks an idle server with no active lobby or game participants, takes a Redis owner lock, and generates more maps only on that idle server. Pool warm-up is breadth-first: it creates one ready map for each profile/size/theme slice before deep-filling any one slice, so CTF, TDM, and Battle Royal become playable during cold starts. Local Docker dev starts checking after 1s, checks every 5s, and can generate up to 16 maps per idle pass; look for `[map-pool]` console lines for generated counts and skipped/status reasons. Repeated status-only lines are sampled once per minute for the whole Redis-backed cluster. Dev allows a higher `PREGENERATED_MAP_AUTO_TOP_UP_MAX_CAPACITY_PRESSURE` than production so idle Docker servers can still top up during normal laptop load while the room/player safety gates stay strict; production also allows small non-room CCU so harmless connected clients do not block an otherwise idle map-generation machine. Raw Prisma SQL query logs are off by default; set `PRISMA_LOG_QUERIES=1` only when debugging database calls, or `PREGENERATED_MAP_POOL_VERBOSE_STATUS=1` for per-slice pool diagnostics. Tune slice targets with `PREGENERATED_MAP_POOL_ARENA_READY_PER_SLICE` and `PREGENERATED_MAP_POOL_BATTLE_ROYAL_READY_PER_SLICE`; both default to 1. Run `pnpm stop:all` to tear down the cluster.

Required production variables for a single direct-address deployment:

- `COLYSEUS_DISTRIBUTED=1`
- `COLYSEUS_REDIS_URL` or `REDIS_URL`
- `PREGENERATED_MAP_AUTO_TOP_UP_ENABLED=1`
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

# Deploy the server, keep the primary region stronger, and add one smaller
# Europe and Asia Machine.
fly deploy -a opus-strike-server --config apps/server/fly.toml
fly scale count app=3 europe=0 asia=0 -a opus-strike-server --config apps/server/fly.toml --region iad
fly scale count europe=1 -a opus-strike-server --config apps/server/fly.toml --region lhr
fly scale count asia=1 -a opus-strike-server --config apps/server/fly.toml --region nrt
```

The checked-in `apps/server/fly.toml` enables:

- `COLYSEUS_DISTRIBUTED=1`
- `COLYSEUS_ROUTING_STRATEGY=fly_replay`
- `COLYSEUS_ROOM_CREATE_STRATEGY=local`
- `COLYSEUS_PUBLIC_ADDRESS=api.slopheroes.xyz`
- `COLYSEUS_REQUIRE_PUBLIC_ADDRESS=1`
- `PREGENERATED_MAP_AUTO_TOP_UP_ENABLED=1`

Fly provides `FLY_APP_NAME`, `FLY_MACHINE_ID`, and `FLY_REGION` at runtime. Matchmaking tickets include the issuing `FLY_REGION`, and matchmaking lobby filters include that region, so players queue into the closest healthy Fly region selected for their request. Each server process registers its Colyseus `processId` to `FLY_MACHINE_ID` in Redis with a heartbeat. WebSocket joins to a room owned by another process return `fly-replay: instance=<machine id>` before the upgrade, so the Fly proxy routes the connection to the room-owning Machine. `/health` reports Redis, distributed matchmaking, and Fly replay registration status.

### Voice Chat

Match voice uses LiveKit through backend-issued, short-lived room tokens. Team voice (default `V`) is heard only by teammates for the whole match, while proximity voice (default `B`) is heard by nearby players with client-side falloff. For local development, start the bundled LiveKit service and set the server environment:

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
- `VOICE_MAX_PARTICIPANTS_PER_ROOM`: LiveKit match-room cap. Default: `32`.

`GET /voice/status` reports whether voice is enabled and why it is disabled without exposing LiveKit secrets.

### Ranked Reward Token Eligibility

Ranked matchmaking only requires an authenticated Discord account. Players can queue, complete ranked matches, and gain rating without a linked wallet or game-token balance. Linked wallets are checked only to decide whether a ranked player can earn Solana rewards.

Server environment:

- `GAME_TOKEN_MINT`: SPL token mint required for ranked SOL reward eligibility.
- `GAME_TOKEN_SYMBOL`: ticker shown in ranked reward UI.
- `RANKED_TOKEN_HOLD_RPC_URL`: RPC URL for ranked reward eligibility checks. Falls back to `SOLANA_RPC_URL`.
- `SOLANA_CLUSTER`: cluster label returned to clients. Default: `mainnet-beta`.
- `RANKED_TOKEN_HOLD_RPC_TIMEOUT_MS`: balance RPC timeout. Default: `5000`.
- `RANKED_TOKEN_HOLD_STATUS_CACHE_MS`: ranked reward eligibility cache window. Default: `30000`.

### Game Token And Paid Skins

Paid skins use the global game SPL token for payment. The server verifies the token payment and grants account skin ownership after confirmation.

Server environment:

- `GAME_TOKEN_MINT`: global SPL token mint used by ranked reward eligibility, skin payments, and future token-gated systems.
- `GAME_TOKEN_SYMBOL`: ticker shown in the UI.
- `SOLANA_RPC_URL`: RPC used for token payments and wallet checks.
- `SOLANA_CLUSTER`: cluster label returned to clients. Default: `mainnet-beta`.
- `WAGER_TREASURY_WALLET`: treasury wallet that receives skin payments.

### SOL Wager Settlement

SOL wager deposits land in `WAGER_TREASURY_WALLET`. On clean settlement the server pays 90% of the pot to the winning paid humans, swaps 5% of the pot from SOL to the configured game token for the treasury wallet, and swaps then burns 5% as the game token.

Server environment:

- `WAGER_SOL_ENABLED`: enable SOL wager deposits and settlement.
- `WAGER_TREASURY_WALLET`: treasury wallet and settlement signer public key.
- `WAGER_SETTLEMENT_SECRET_KEY`: treasury signer secret key used for payouts, token conversion, and burns.
- `GAME_TOKEN_MINT`: SPL or Token-2022 game token mint to receive and burn.
- `JUPITER_API_KEY`: Jupiter Swap API key used to build SOL to game-token swaps.
- `JUPITER_SWAP_BASE_URL`: Jupiter Router API base URL. Default: `https://api.jup.ag/swap/v2`.
- `WAGER_TOKEN_SWAP_SLIPPAGE_BPS`: swap slippage in basis points. Default: `50`.
- `WAGER_RPC_CAPACITY_BACKOFF_MS`: cluster-wide wager background-job pause after an RPC monthly-capacity 429. Default: `21600000` (6 hours).

Treasury recovery only polls Solana while an unsigned payment intent can still be recovered. It persists the newest inspected signature so unrelated treasury transactions are not fetched again after a restart or by another server replica.

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
