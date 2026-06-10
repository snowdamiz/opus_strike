import { Transaction } from '@solana/web3.js';

export function lamportsToSolDisplay(lamports: string | number | bigint | undefined): string {
  const value = typeof lamports === 'bigint'
    ? lamports
    : typeof lamports === 'number'
      ? BigInt(Math.max(0, Math.trunc(lamports)))
      : typeof lamports === 'string' && /^[0-9]+$/.test(lamports)
        ? BigInt(lamports)
        : 0n;

  const whole = value / 1_000_000_000n;
  const fraction = (value % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

export function solInputToLamports(input: string): string {
  const normalized = input.trim();
  if (!/^\d+(\.\d{0,9})?$/.test(normalized)) {
    throw new Error('Enter a valid SOL amount');
  }
  const [whole, fraction = ''] = normalized.split('.');
  const lamports = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
  if (lamports <= 0n) {
    throw new Error('Cover charge must be greater than zero');
  }
  return lamports.toString();
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function deserializeWagerPaymentTransaction(transactionBase64: string): Transaction {
  return Transaction.from(base64ToBytes(transactionBase64));
}
