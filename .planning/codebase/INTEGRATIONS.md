# External Integrations

**Analysis Date:** 2026-01-22

## APIs & External Services

**Solana Blockchain:**
- Phantom Wallet - User authentication via wallet signing
  - SDK/Client: `@solana/web3.js`, `tweetnacl`, `bs58`
  - Integration: `apps/client/src/contexts/WalletContext.tsx`
  - Auth: Wallet signing (no transaction costs, message-based)

**Game Multiplayer:**
- Colyseus - Real-time game state synchronization
  - Server: `colyseus` 0.15.55 with `@colyseus/ws-transport`
  - Client: `colyseus.js` 0.15.25
  - Server rooms: `game_room`, `lobby_room` (defined in `apps/server/src/index.ts`)
  - WebSocket connection on configured `SERVER_URL`

## Data Storage

**Databases:**
- PostgreSQL 16-alpine
  - Connection: `DATABASE_URL` environment variable
  - Client: Prisma ORM (`@prisma/client`)
  - Container: Docker image `postgres:16-alpine`
  - Port: 5432 (local development)
  - Credentials: User `voxelstrike`, Password `voxelstrike_dev` (development)
  - Database: `voxelstrike`

**File Storage:**
- Local filesystem only (no external storage integration)
- 3D models: GLTF assets served from `apps/client/public/`
- Static assets: Images, fonts in `apps/client/public/`

**Caching:**
- None detected (Colyseus handles state caching in-memory per room)

## Authentication & Identity

**Auth Provider:**
- Custom implementation with Solana wallet integration

**Implementation Details:**
- Location: `apps/server/src/auth/` (routes, verify, nonce management)
- Flow:
  1. Client requests nonce via `GET /auth/nonce?walletAddress=<address>`
  2. Server generates unique nonce and stores temporarily (5-minute TTL)
  3. Client signs message via Phantom wallet using `signMessage()`
  4. Client submits signature to `POST /auth/verify`
  5. Server validates signature using `verifySignature()` from `apps/server/src/auth/verify.ts`
  6. Server creates JWT token and sets HTTP-only cookie
  7. New users complete registration via `POST /auth/register`
  8. Session validation via `GET /auth/session` uses JWT from cookies

**JWT Configuration:**
- Secret: `JWT_SECRET` environment variable (development default: `voxel-strike-secret-key-change-in-production`)
- Expiry: 30 days
- Cookie: `auth_token` (HTTP-only, secure in production, sameSite in production)
- Token payload: `{ walletAddress, userId }`

**Signature Verification:**
- Algorithm: Ed25519 (Solana default)
- Libraries: `tweetnacl` for cryptographic verification, `bs58` for key decoding
- Verification code: `apps/server/src/auth/verify.ts::verifySignature()`
- Protection: Nonce-based to prevent replay attacks

## Monitoring & Observability

**Error Tracking:**
- None detected (application logs errors to console)

**Logs:**
- Console logging only (development)
- No centralized logging service integrated
- Server startup information logged to console

## CI/CD & Deployment

**Hosting:**
- Not deployed (local development environment)
- Docker Compose for local PostgreSQL

**CI Pipeline:**
- None detected (no GitHub Actions, GitLab CI, or similar)

**Build Pipeline:**
- Turborepo orchestrates builds
- Vite builds client to `apps/client/dist`
- TypeScript builds server to `apps/server/dist`
- Commands: `pnpm build`, `pnpm build:client`, `pnpm build:server`

## Environment Configuration

**Required Environment Variables:**

**Server (`apps/server/.env`):**
- `DATABASE_URL` - PostgreSQL connection string (format: `postgresql://user:password@host:port/database?schema=public`)
- `PORT` - Server port (default: 2567)
- `JWT_SECRET` - Secret key for JWT signing (must change in production)
- `NODE_ENV` - Environment mode (`development`, `production`)

**Client:**
- `VITE_SERVER_URL` - WebSocket server URL (development default: `ws://localhost:2567`, production: `wss://...`)
- Set via `import.meta.env` in Vite
- Configured in `apps/client/src/config/environment.ts`

**Docker Compose:**
- `POSTGRES_USER` - PostgreSQL user (default: `voxelstrike`)
- `POSTGRES_PASSWORD` - PostgreSQL password (default: `voxelstrike_dev`)
- `POSTGRES_DB` - Database name (default: `voxelstrike`)

**Secrets Location:**
- Development: `.env` files in `apps/server/` (Git-ignored)
- Production: Environment variables should be set via hosting platform secrets management

## Webhooks & Callbacks

**Incoming:**
- `POST /auth/verify` - Webhook for signature verification (internal)
- `POST /auth/register` - User registration callback
- `GET /auth/session` - Session validation endpoint
- `GET /auth/user/:walletAddress` - User lookup endpoint
- `GET /health` - Health check endpoint
- `GET /lobbies` - List available game lobbies

**Outgoing:**
- None detected (no external service callbacks)

## WebSocket Configuration

**Server:**
- Transport: `@colyseus/ws-transport`
- Ping interval: 5000ms
- Max retries: 3
- Port: 2567 (configurable via `PORT` env var)

**Client Connection:**
- Library: `colyseus.js`
- URL: `ws://localhost:2567` (dev) or `wss://...` (production)
- CORS: Configured in `apps/server/src/index.ts`
  - Allowed origins: `http://localhost:5173`, `http://localhost:3000`, `http://127.0.0.1:5173`, `http://127.0.0.1:3000`
  - All origins allowed in non-production environments

## Room Management

**Game Rooms:**
- `game_room` - Active game sessions (5v5 CTF matches)
- `lobby_room` - Matchmaking and team selection lobbies

**Room Features:**
- Real-time listing via Colyseus `enableRealtimeListing()`
- Room metadata: `isPublic`, `name`, `status`
- Graceful shutdown on SIGTERM/SIGINT

---

*Integration audit: 2026-01-22*
