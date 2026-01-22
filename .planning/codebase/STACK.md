# Technology Stack

**Analysis Date:** 2026-01-22

## Languages

**Primary:**
- TypeScript 5.6.3 - All applications and packages
- JavaScript - Runtime (Node.js for server, browser for client)

**Secondary:**
- CSS - Styling with Tailwind CSS
- SQL - Database queries (PostgreSQL via Prisma)

## Runtime

**Environment:**
- Node.js - Server runtime
- Browser - Client runtime

**Package Manager:**
- pnpm 9.12.0 - Package management with monorepo support
- Lockfile: pnpm-lock.yaml (present)

## Frameworks

**Core:**
- React 18.3.1 - UI framework for client
- React Three Fiber 8.17.10 - 3D rendering in React
- Three.js 0.169.0 - 3D graphics library
- Express 4.21.1 - Web server framework
- Colyseus 0.15.55 - Real-time game server

**Testing:**
- Not detected - No test framework configured

**Build/Dev:**
- Turbo 2.2.3 - Monorepo build system
- Vite 5.4.10 - Build tool and dev server for client
- tsx 4.19.2 - TypeScript execution environment
- TypeScript 5.6.3 - Type checking and compilation

## Key Dependencies

**Critical:**
- Prisma 5.22.0 - Database ORM and schema management
- @prisma/client 5.22.0 - Database client
- @colyseus/schema 2.0.0 - Real-time state synchronization
- @colyseus/ws-transport 0.15.0 - WebSocket transport
- colyseus.js 0.15.25 - Client library for real-time communication

**Infrastructure:**
- Solana Web3.js 1.95.4 - Blockchain integration
- @solana/web3.js 1.95.4 - Solana blockchain client
- bs58 6.0.0 - Base58 encoding for Solana
- tweetnacl 1.0.3 - Cryptographic utilities
- jsonwebtoken 9.0.2 - JWT token management
- cookie-parser 1.4.7 - Cookie parsing middleware

## Configuration

**Environment:**
- Environment variables required:
  - DATABASE_URL - PostgreSQL connection string
  - JWT_SECRET - JWT signing secret (defaults to fallback in dev)
- Global dependencies tracked via **/.env.*local

**Build:**
- Turbo.json - Monorepo task orchestration
- TypeScript configs for each package/apps
- Vite config with path aliases and optimizations
- Tailwind CSS with custom theme configuration

## Platform Requirements

**Development:**
- Node.js runtime
- pnpm package manager
- TypeScript compiler

**Production:**
- Node.js server
- PostgreSQL database
- WebSocket server for real-time communication
- Static file serving for client build

---

*Stack analysis: 2026-01-22*