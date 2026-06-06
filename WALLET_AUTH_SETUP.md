# Phantom Wallet Authentication Setup

This guide explains how to set up and run the Phantom wallet authentication system for Slop Heroes.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- [Node.js](https://nodejs.org/) v18+ installed
- [pnpm](https://pnpm.io/) package manager installed
- [Phantom Wallet](https://phantom.app/) browser extension installed

## Setup Steps

### 1. Start the PostgreSQL Database

First, start the PostgreSQL database using Docker:

```bash
# From the project root directory
docker-compose up -d
```

This will start a PostgreSQL container with:
- Database: `voxelstrike`
- User: `voxelstrike`
- Password: `voxelstrike_dev`
- Port: `5432`

### 2. Configure Environment Variables

Create a `.env` file in the `apps/server` directory:

```bash
# apps/server/.env
DATABASE_URL="postgresql://voxelstrike:voxelstrike_dev@localhost:5432/voxelstrike?schema=public"
PORT=2567
```

### 3. Install Dependencies

```bash
# From the project root directory
pnpm install
```

### 4. Initialize the Database

```bash
# From the apps/server directory
cd apps/server
pnpm db:push
```

This will create the database tables based on the Prisma schema.

### 5. Start the Development Servers

```bash
# From the project root directory
pnpm dev
```

This starts both the client (port 3000) and server (port 2567).

## How Authentication Works

### Connection Flow

1. **Connect Wallet**: User clicks "Connect Phantom" button
2. **Approve Connection**: Phantom prompts user to approve the connection
3. **Sign Message**: After connection, user is prompted to sign a verification message
4. **Verify Signature**: Server verifies the signature cryptographically
5. **New Users**: First-time users are prompted to enter a display name
6. **Returning Users**: Existing users are automatically logged in

### Security

- **Message Signing**: Uses cryptographic signatures to verify wallet ownership
- **Nonce-based**: Each authentication attempt uses a unique nonce to prevent replay attacks
- **No Blockchain Transactions**: Authentication is free and doesn't require any SOL

### Database Schema

Users are stored with the following information:

```prisma
model User {
  id            String   @id
  walletAddress String   @unique
  name          String
  createdAt     DateTime
  updatedAt     DateTime
  
  // Stats
  totalGames    Int
  totalWins     Int
  totalKills    Int
  totalDeaths   Int
  totalCaptures Int
}
```

## API Endpoints

### Authentication Routes (`/auth`)

- `GET /auth/nonce?walletAddress=<address>` - Get a nonce for signing
- `POST /auth/verify` - Verify a signed message
- `POST /auth/register` - Register a new user with their chosen name
- `GET /auth/user/:walletAddress` - Get user info by wallet address

## Development Notes

### Viewing the Database

You can use Prisma Studio to view and manage database records:

```bash
cd apps/server
pnpm db:studio
```

### Resetting the Database

To reset the database and start fresh:

```bash
# Stop the container
docker-compose down -v

# Start fresh
docker-compose up -d

# Re-initialize schema
cd apps/server
pnpm db:push
```

## Troubleshooting

### "Phantom wallet is not installed"

Install the Phantom wallet browser extension from https://phantom.app/

### "Connection rejected"

Click "Connect" again and approve the connection request in Phantom.

### "Invalid signature"

Make sure you're signing the message when Phantom prompts you. If you reject the signature, you'll need to try again.

### Database Connection Error

1. Make sure Docker Desktop is running
2. Verify the PostgreSQL container is running: `docker-compose ps`
3. Check the DATABASE_URL in your `.env` file matches the docker-compose settings
