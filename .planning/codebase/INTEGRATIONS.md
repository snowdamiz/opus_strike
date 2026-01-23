# External Integrations

**Analysis Date:** 2026-01-22

## APIs & External Services

**Blockchain:**
- Solana - Wallet-based authentication
  - SDK/Client: `@solana/web3.js` 1.95.4
  - Auth: Phantom wallet browser extension
  - Purpose: User authentication via wallet signature, no transactions
  - Implementation: `apps/server/src/auth/verify.ts`, `apps/client/src/contexts/WalletContext.tsx`

## Data Storage

**Databases:**
- PostgreSQL 16
  - Connection: `DATABASE_URL` env var
  - Client: Prisma ORM (`@prisma/client` 5.22.0)
  - Schema: `apps/server/prisma/schema.prisma`
  - Container: Docker Compose service `voxel-strike-db` on port 5432
  - Default credentials: `voxelstrike` / `voxelstrike_dev` (development only)

**File Storage:**
- Local filesystem only
- No cloud storage integration detected

**Caching:**
- In-memory nonce store for auth flow
  - Implementation: `Map` in `apps/server/src/auth/routes.ts`
  - Lifecycle: 5-minute TTL with periodic cleanup
  - Purpose: Temporary storage for wallet signature nonces

## Authentication & Identity

**Auth Provider:**
- Custom Solana wallet authentication
  - Implementation: Sign-in with Ethereum (SIWE) style message signing
  - Flow: Nonce generation → Phantom signature → Server verification
  - Session: JWT tokens stored in HTTP-only cookies (30-day expiry)
  - Signature verification: TweetNaCl (`tweetnacl` 1.0.3)
  - Routes: `apps/server/src/auth/routes.ts`

**User Database:**
- Prisma User model
  - Fields: `walletAddress` (unique), `name`, stats fields
  - Location: `apps/server/prisma/schema.prisma`

## Monitoring & Observability

**Error Tracking:**
- None - console.error logging only

**Logs:**
- Console-based logging
- No external logging service integration

**Performance:**
- r3f-perf 7.2.3 for client-side Three.js performance monitoring (dev only)
- Statsjs integration via `@types/stats.js`

## CI/CD & Deployment

**Hosting:**
- Not configured - local development only

**CI Pipeline:**
- None detected - no GitHub Actions, Jenkins, or other CI config files

**Container Orchestration:**
- Docker Compose 3.8 - Database only
  - Service: `postgres` (PostgreSQL 16-alpine)
  - Healthcheck: `pg_isready` with 5-second intervals
  - Volume: `postgres_data` for persistence
  - File: `docker-compose.yml`

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection string (format: `postgresql://user:password@host:port/database`)
- `JWT_SECRET` - Secret key for JWT signing (defaults to insecure dev key)
- `PORT` - Server port (defaults to 2567)
- `NODE_ENV` - Environment mode (affects CORS, cookie security)

**Secrets location:**
- `apps/server/.env` - Local development
- Not committed to git (in `.gitignore`)

**Client configuration:**
- `apps/client/src/config/environment.ts` - Server URL configuration
- Vite env variable support via `import.meta.env`

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

## Game Networking

**Real-time Communication:**
- Colyseus WebSocket server
  - Transport: `@colyseus/ws-transport` 0.15.0
  - Client SDK: `colyseus.js` 0.15.25
  - State sync: `@colyseus/schema` 2.0.0
  - Rooms: `GameRoom`, `LobbyRoom`
  - Endpoint: `ws://localhost:2567` (configurable via client config)
  - Ping: 5-second intervals, 3 max retries

**CORS Configuration:**
- Allowed origins: `http://localhost:5173`, `http://localhost:3000`, `http://127.0.0.1:5173`, `http://127.0.0.1:3000`
- Credentials: Enabled for cookie-based auth
- Implementation: Express middleware in `apps/server/src/index.ts`

## Browser APIs

**WebGL:**
- Three.js renderer with WebGL 2.0
- GPU detection: `detect-gpu` 5.0.70

**WebSockets:**
- Native browser WebSocket API (via Colyseus client)

**Web Crypto:**
- Not used - Solana signature verification done via TweetNaCl

**Phantom Wallet API:**
- Browser extension injection
  - Global: `window.phantom.solana` or `window.solana`
  - Methods: `connect()`, `disconnect()`, `signMessage()`, event listeners
  - Detection: `isPhantom` flag check
  - Implementation: `apps/client/src/contexts/WalletContext.tsx`

---

*Integration audit: 2026-01-22*
