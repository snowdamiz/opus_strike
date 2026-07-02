export type TokenAmountInput = string | number | bigint | null | undefined;

const COMPACT_TOKEN_UNITS: Array<[value: bigint, suffix: string]> = [
  [1_000_000_000_000n, 'T'],
  [1_000_000_000n, 'B'],
  [1_000_000n, 'M'],
  [1_000n, 'K'],
];

function parseTokenAmount(value: TokenAmountInput): bigint | null {
  if (value == null) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const integer = Math.trunc(value);
    return Number.isSafeInteger(integer) ? BigInt(integer) : null;
  }

  const normalized = value.trim().replace(/,/g, '');
  if (!/^[+-]?\d+$/.test(normalized)) return null;

  try {
    return BigInt(normalized);
  } catch {
    return null;
  }
}

function roundDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function formatTenths(tenths: bigint): string {
  const whole = tenths / 10n;
  const fraction = tenths % 10n;
  const wholeLabel = whole.toLocaleString('en-US');
  return fraction === 0n ? wholeLabel : `${wholeLabel}.${fraction}`;
}

export function formatCompactTokenAmount(value: TokenAmountInput, fallback = '0'): string {
  const amount = parseTokenAmount(value);
  if (amount === null) return fallback;

  const sign = amount < 0n ? '-' : '';
  const absolute = amount < 0n ? -amount : amount;

  for (let i = 0; i < COMPACT_TOKEN_UNITS.length; i += 1) {
    const [unit, suffix] = COMPACT_TOKEN_UNITS[i];
    if (absolute < unit) continue;

    const roundedTenths = roundDiv(absolute * 10n, unit);
    const nextUnit = COMPACT_TOKEN_UNITS[i - 1];
    if (roundedTenths >= 10_000n && nextUnit) {
      const [nextValue, nextSuffix] = nextUnit;
      return `${sign}${formatTenths(roundDiv(absolute * 10n, nextValue))}${nextSuffix}`;
    }

    return `${sign}${formatTenths(roundedTenths)}${suffix}`;
  }

  return `${sign}${absolute.toLocaleString('en-US')}`;
}

export function formatTokenBaseUnits(
  value: TokenAmountInput,
  decimals: number | null | undefined,
  fallback = '0'
): string {
  const amount = parseTokenAmount(value);
  if (amount === null) return fallback;
  if (decimals === null || decimals === undefined || !Number.isInteger(decimals) || decimals < 0) {
    return formatCompactTokenAmount(value, fallback);
  }

  const sign = amount < 0n ? '-' : '';
  const absolute = amount < 0n ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = absolute % scale;

  if (fraction === 0n) {
    return `${sign}${formatCompactTokenAmount(whole, fallback)}`;
  }

  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${sign}${whole.toLocaleString('en-US')}.${fractionText}`;
}
