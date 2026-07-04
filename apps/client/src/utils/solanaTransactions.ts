import type { Transaction } from '@solana/web3.js';

export async function transactionFromBase64(base64: string): Promise<Transaction> {
  const { Transaction } = await import('@solana/web3.js');
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return Transaction.from(bytes);
}
