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
