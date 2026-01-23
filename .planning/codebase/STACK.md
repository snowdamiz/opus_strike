# Technology Stack

**Analysis Date:** 2026-01-22

## Languages

**Primary:**
- TypeScript 5.6.3 - Used throughout all packages for type-safe code
- JavaScript (ES2022) - Runtime target for all compiled code

**Secondary:**
- HTML5 - Client-side markup
- CSS3 - Styling with Tailwind CSS

## Runtime

**Environment:**
- Node.js 18+ (development), ES2022 module target

**Package Manager:**
- pnpm 9.12.0
- Lockfile: `pnpm-lock.yaml` (present)

## Frameworks

**Core:**
- React 18.3.1 - UI framework for client application
- Express 4.21.1 - HTTP server framework for backend
- Three.js 0.169.0 - 3D graphics rendering engine
- @react-three/fiber 8.17.10 - React renderer for Three.js
- @react-three/drei 9.114.3 - Utility library for R3F (GLTFLoader, Instances)

**Physics & Game Logic:**
- @dimforge/rapier3d-compat 0.14.0 - Physics simulation engine (used in both client and server)

**Multiplayer:**
- Colyseus 0.15.55 - Real-time multiplayer framework (server)
- colyseus.js 0.15.25 - Colyseus client library
- @colyseus/schema 2.0.0 - Data serialization for Colyseus
- @colyseus/ws-transport 0.15.0 - WebSocket transport for Colyseus

**Authentication & Crypto:**
- @solana/web3.js 1.95.4 - Solana blockchain interaction (wallet handling)
- tweetnacl 1.0.3 - Cryptographic signature verification
- bs58 6.0.0 - Base58 encoding/decoding for Solana keys

**Database:**
- @prisma/client 5.22.0 - ORM for database access
- prisma 5.22.0 - Database schema and migration management
- postgresql 16-alpine - PostgreSQL database (via Docker)

**State Management:**
- zustand 5.0.0 - Lightweight state management for client-side state

**Utilities:**
- jsonwebtoken 9.0.2 - JWT token generation and verification
- cookie-parser 1.4.7 - HTTP cookie parsing middleware
- dotenv 16.4.5 - Environment variable management

**Development & Build:**
- Vite 5.4.10 - Frontend build tool and dev server (client)
- Turborepo 2.2.3 - Monorepo task runner and build orchestrator
- tsx 4.19.2 - TypeScript execution for Node.js (server dev)
- PostCSS 8.4.47 - CSS processing for Tailwind CSS
- Autoprefixer 10.4.20 - Browser prefix automation
- Tailwind CSS 3.4.14 - Utility-first CSS framework

**Testing & Quality:**
- r3f-perf 7.2.3 - Performance monitoring for React Three Fiber (development only)

**Browser Compatibility:**
- buffer 6.0.3 - Node.js Buffer polyfill for browser

## Key Dependencies

**Critical:**
- Colyseus ecosystem - Powers real-time multiplayer synchronization; removing would require alternative architecture
- Rapier3D - Provides physics simulation for character movement and collision detection
- Three.js + React Three Fiber - Foundation for 3D rendering; critical for visual presentation
- Solana Web3.js - Enables Phantom wallet integration for authentication

**Infrastructure:**
- Prisma - Provides type-safe database access and schema management
- PostgreSQL - Production-ready relational database for user persistence
- Express - HTTP API server for authentication and game state queries
- Turborepo - Manages monorepo build dependencies and caching

## Configuration

**Environment:**
- Vite environment variables (accessed via `import.meta.env`)
- Dotenv for server-side environment configuration (`.env` file)
- TypeScript strict mode enabled with type checking

**Build:**
- `vite.config.ts` - Vite configuration for client build and dev server
- `tsconfig.base.json` - Shared TypeScript compiler options (ES2022 target, strict mode)
- `tsconfig.json` - Per-package TypeScript configs
- `turbo.json` - Turborepo task graph and caching configuration
- `tailwind.config.js` - Custom Tailwind theme with game-specific colors and animations

**Database:**
- `prisma/schema.prisma` - Data model definition
- Database migrations via Prisma CLI

## Platform Requirements

**Development:**
- Node.js 18 or higher
- Docker Desktop (for PostgreSQL database)
- pnpm package manager
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Phantom wallet browser extension (for wallet authentication)

**Production:**
- Node.js 18+ runtime
- PostgreSQL 16+ database instance
- Docker container support recommended
- HTTPS/WSS for secure connections
- Environment variables: `DATABASE_URL`, `PORT`, `JWT_SECRET`, `NODE_ENV`, `VITE_SERVER_URL`

## Architecture Highlights

**Monorepo Structure:**
- Turborepo orchestrates builds across 5 packages with shared TypeScript configuration
- Workspace packages include: `@voxel-strike/client`, `@voxel-strike/server`, `@voxel-strike/game-logic`, `@voxel-strike/physics`, `@voxel-strike/shared`
- Path alias configured in Vite: `@/*` → `./src`

**Module System:**
- All packages configured as ES modules (`"type": "module"`)
- Vite handles browser-compatible module resolution
- CommonJS/ESM interop via esbuild configuration

**TypeScript Configuration:**
- Base config targets ES2022 with DOM/DOM.Iterable libs
- Strict null checks enabled
- Module resolution: bundler (for Vite)
- Decimal maps and source maps enabled for debugging

---

*Stack analysis: 2026-01-22*
