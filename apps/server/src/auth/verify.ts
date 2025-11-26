import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

/**
 * Verify a signed message from a Solana wallet
 */
export function verifySignature(
  message: string,
  signature: string,
  walletAddress: string
): boolean {
  try {
    // Decode the message to Uint8Array
    const messageBytes = new TextEncoder().encode(message);
    
    // Decode the signature from base58
    const signatureBytes = bs58.decode(signature);
    
    // Get the public key bytes from the wallet address
    const publicKey = new PublicKey(walletAddress);
    const publicKeyBytes = publicKey.toBytes();
    
    // Verify the signature using nacl
    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKeyBytes
    );
    
    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Generate a unique nonce for signing
 */
export function generateNonce(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${random}`;
}

/**
 * Create a message for the user to sign
 */
export function createSignMessage(nonce: string): string {
  return `Sign this message to authenticate with Voxel Strike.\n\nNonce: ${nonce}\n\nThis signature will not trigger any blockchain transaction or cost any fees.`;
}

