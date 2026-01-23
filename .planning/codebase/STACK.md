# Technology Stack

**Analysis Date:** 2026-01-22

## Languages

**Primary:**
- TypeScript 5.6.3 - Used across all packages, client, and server
- JavaScript - Build configurations (Vite, Tailwind, PostCSS)

**Secondary:**
- GLSL - Shader code for custom visual effects

## Runtime

**Environment:**
- Node.js 25.3.0 (detected)
- Browser - Client runs in browser with ES2022+ features

**Package Manager:**
- pnpm 9.12.0
- Lockfile: present (`pnpm-lock.yaml`)
- Workspace: Turborepo monorepo with `pnpm-workspace.yaml`

## Frameworks

**Core:**
- React 18.3.1 - UI framework for client
- React Three Fiber 8.18.0 - React renderer for Three.js
- Three.js 0.169.0 - 3D graphics engine
- Express 4.21.1 - HTTP server for auth routes
- Colyseus 0.15.55 - Multiplayer game server framework

**Testing:**
- r3f-perf 7.2.3 - Performance monitoring for React Three Fiber (dev only)

**Build/Dev:**
- Vite 5.4.10 - Build tool and dev server for client
- tsx 4.19.2 - TypeScript execution for server
- Turbo 2.6.1 - Monorepo build orchestration
- esbuild - Bundled with Vite for fast transpilation

## Key Dependencies

**Critical:**
- @dimforge/rapier3d-compat 0.14.0 - Physics engine (client and server)
- @solana/web3.js 1.95.4 - Solana blockchain SDK for wallet auth
- @react-three/drei 9.122.0 - React Three Fiber helpers and abstractions
- @prisma/client 5.22.0 - Database ORM client
- Prisma 5.22.0 - Database toolkit and migrations (dev)

**Infrastructure:**
- colyseus.js 0.15.25 - Colyseus client SDK
- @colyseus/schema 2.0.0 - State synchronization schema
- @colyseus/ws-transport 0.15.0 - WebSocket transport layer
- zustand 5.0.0 - Client-side state management (client), 3.7.2 (drei dependency)
- cookie-parser 1.4.7 - HTTP cookie parsing middleware
- jsonwebtoken 9.0.2 - JWT creation and verification for auth
- dotenv 16.4.5 - Environment variable loading

**Cryptography:**
- tweetnacl 1.0.3 - Signature verification for Solana wallets
- bs58 6.0.0 - Base58 encoding/decoding for Solana addresses and signatures

**UI:**
- Tailwind CSS 3.4.14 - Utility-first CSS framework
- PostCSS 8.4.47 - CSS processing pipeline
- Autoprefixer 10.4.20 - CSS vendor prefixing

**Development:**
- buffer 6.0.3 - Browser polyfill for Node.js Buffer API
- cross-env 7.0.3 - Cross-platform environment variables

## Configuration

**Environment:**
- Server uses `.env` files loaded via dotenv
- Required env vars: `DATABASE_URL`, `JWT_SECRET`, `PORT` (optional)
- Client uses `config/environment.ts` for server URL configuration
- Vite provides `process.env` polyfill via `define` config

**Build:**
- `tsconfig.base.json` - Shared TypeScript config (ES2022 target, bundler module resolution, strict mode)
- `turbo.json` - Turborepo task pipeline configuration
- `vite.config.ts` - Client build config with React plugin, path aliases, esbuild optimizations
- `tailwind.config.js` - Tailwind theme customization
- `postcss.config.js` - PostCSS with Tailwind and Autoprefixer
- Individual `tsconfig.json` per package/app extending base config

## Platform Requirements

**Development:**
- Node.js 18+ (18 minimum, 25.3.0 detected in environment)
- pnpm 9+ (9.12.0 specified)
- Docker and Docker Compose (for PostgreSQL database)
- Modern browser with WebGL 2.0 support

**Production:**
- Node.js 18+ runtime for server
- PostgreSQL 16 database
- Static file hosting for client build output
- WebSocket-capable hosting for Colyseus server

---

*Stack analysis: 2026-01-22*
