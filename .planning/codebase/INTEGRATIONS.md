# External Integrations

**Analysis Date:** 2026-01-22

## APIs & External Services

**Blockchain:**
- Solana - Blockchain platform for wallet integration
  - SDK/Client: @solana/web3.js 1.95.4
  - Auth: Wallet-based authentication through bs58 encoding

**Game Services:**
- Colyseus - Real-time multiplayer game server
  - SDK/Client: colyseus.js 0.15.25
  - Protocol: WebSocket for real-time state synchronization
  - Auth: Custom JWT-based authentication

## Data Storage

**Databases:**
- PostgreSQL - Primary relational database
  - Connection: DATABASE_URL environment variable
  - Client: Prisma ORM (@prisma/client 5.22.0)
  - Schema: User model with wallet address and game statistics

**File Storage:**
- Local filesystem only - No external file storage detected

**Caching:**
- Not detected - No caching layer configured

## Authentication & Identity

**Auth Provider:**
- Custom JWT-based authentication
  - Implementation: Express middleware with jsonwebtoken
  - Wallet-based: Uses Solana wallet addresses as unique identifiers
  - Environment: JWT_SECRET for token signing

## Monitoring & Observability

**Error Tracking:**
- Not detected - No error tracking service configured

**Logs:**
- Console logging - Standard Node.js/React logging

## CI/CD & Deployment

**Hosting:**
- Not detected - No deployment configuration found

**CI Pipeline:**
- Not detected - No CI configuration files present

## Environment Configuration

**Required env vars:**
- DATABASE_URL - PostgreSQL connection string
- JWT_SECRET - JWT signing secret (has fallback for development)

**Secrets location:**
- Environment variables - No centralized secrets management detected

## Webhooks & Callbacks

**Incoming:**
- Not detected - No webhook endpoints configured

**Outgoing:**
- Not detected - No outbound webhook services

---

*Integration audit: 2026-01-22*