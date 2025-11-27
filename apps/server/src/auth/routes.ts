import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import prisma from '../db';
import { verifySignature, generateNonce, createSignMessage } from './verify';

const router: RouterType = Router();

// In-memory store for nonces (in production, use Redis or similar)
const nonceStore = new Map<string, { nonce: string; timestamp: number }>();

// Clean up old nonces every 5 minutes
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const [address, data] of nonceStore.entries()) {
    if (data.timestamp < fiveMinutesAgo) {
      nonceStore.delete(address);
    }
  }
}, 5 * 60 * 1000);

/**
 * GET /auth/nonce
 * Get a nonce for signing
 */
router.get('/nonce', (req: Request, res: Response) => {
  const walletAddress = req.query.walletAddress as string;
  
  if (!walletAddress) {
    res.status(400).json({ error: 'Wallet address is required' });
    return;
  }
  
  const nonce = generateNonce();
  const message = createSignMessage(nonce);
  
  // Store the nonce temporarily
  nonceStore.set(walletAddress, { nonce, timestamp: Date.now() });
  
  res.json({ nonce, message });
});

/**
 * POST /auth/verify
 * Verify a signed message and authenticate the user
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { walletAddress, signature, nonce } = req.body;
    
    if (!walletAddress || !signature || !nonce) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }
    
    // Check if we have a valid nonce for this wallet
    const storedData = nonceStore.get(walletAddress);
    if (!storedData || storedData.nonce !== nonce) {
      res.status(401).json({ error: 'Invalid or expired nonce' });
      return;
    }
    
    // Verify the signature
    const message = createSignMessage(nonce);
    const isValid = verifySignature(message, signature, walletAddress);
    
    if (!isValid) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
    
    // Clear the used nonce
    nonceStore.delete(walletAddress);
    
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { walletAddress },
    });
    
    if (existingUser) {
      // Return existing user
      res.json({
        authenticated: true,
        isNewUser: false,
        user: {
          id: existingUser.id,
          walletAddress: existingUser.walletAddress,
          name: existingUser.name,
          stats: {
            totalGames: existingUser.totalGames,
            totalWins: existingUser.totalWins,
            totalKills: existingUser.totalKills,
            totalDeaths: existingUser.totalDeaths,
            totalCaptures: existingUser.totalCaptures,
          },
        },
      });
    } else {
      // New user - needs to set name
      res.json({
        authenticated: true,
        isNewUser: true,
        walletAddress,
      });
    }
  } catch (error) {
    console.error('Auth verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /auth/register
 * Register a new user with their chosen name
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { walletAddress, name, signature, nonce } = req.body;
    
    if (!walletAddress || !name) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }
    
    // Validate name
    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 16) {
      res.status(400).json({ error: 'Name must be between 2 and 16 characters' });
      return;
    }
    
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { walletAddress },
    });
    
    if (existingUser) {
      res.status(409).json({ error: 'User already exists' });
      return;
    }
    
    // Create new user
    const newUser = await prisma.user.create({
      data: {
        walletAddress,
        name: trimmedName,
      },
    });
    
    res.json({
      success: true,
      user: {
        id: newUser.id,
        walletAddress: newUser.walletAddress,
        name: newUser.name,
        stats: {
          totalGames: newUser.totalGames,
          totalWins: newUser.totalWins,
          totalKills: newUser.totalKills,
          totalDeaths: newUser.totalDeaths,
          totalCaptures: newUser.totalCaptures,
        },
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /auth/user/:walletAddress
 * Get user info by wallet address
 */
router.get('/user/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    const user = await prisma.user.findUnique({
      where: { walletAddress },
    });
    
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    
    res.json({
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        name: user.name,
        stats: {
          totalGames: user.totalGames,
          totalWins: user.totalWins,
          totalKills: user.totalKills,
          totalDeaths: user.totalDeaths,
          totalCaptures: user.totalCaptures,
        },
      },
    });
  } catch (error) {
    console.error('User lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

