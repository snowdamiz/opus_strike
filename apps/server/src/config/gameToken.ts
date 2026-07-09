/**
 * Single source of truth for the game's SPL token.
 *
 * Every feature that references the game token (ranked rewards, skin shop,
 * etc.) reads its mint address, ticker, and cluster from here. Features must
 * NOT store or expose their own separate token configuration.
 *
 * Configured via deployment environment:
 *   - GAME_TOKEN_MINT    : the SPL token mint address (base58)
 *   - GAME_TOKEN_SYMBOL  : the ticker, e.g. "SLOP"
 *   - SOLANA_CLUSTER     : the cluster the token lives on (default mainnet-beta)
 *   - SOLANA_RPC_URL     : the RPC endpoint used for on-chain checks
 *
 * Legacy per-feature env vars (SKIN_SHOP_TOKEN_*) are honored as fallbacks so
 * existing deployments keep working until they migrate to GAME_TOKEN_*.
 */

export interface GameTokenConfig {
  /** SPL token mint address, or null when no game token is configured. */
  mintAddress: string | null;
  /** Normalized uppercase ticker (e.g. "SLOP"), or "" when unset/invalid. */
  symbol: string;
  /** Solana cluster the token lives on. */
  cluster: string;
  /** Whether a Solana RPC endpoint is configured for on-chain checks. */
  rpcConfigured: boolean;
}

function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return '';
}

export function getGameTokenConfig(): GameTokenConfig {
  const mintAddress = readEnv('GAME_TOKEN_MINT', 'SKIN_SHOP_TOKEN_MINT') || null;

  const rawSymbol = readEnv('GAME_TOKEN_SYMBOL', 'SKIN_SHOP_TOKEN_SYMBOL')
    .replace(/^\$/, '')
    .toUpperCase();
  const symbol = /^[A-Z0-9]{1,12}$/.test(rawSymbol) ? rawSymbol : '';

  const cluster = readEnv('SOLANA_CLUSTER', 'SKIN_SHOP_CLUSTER') || 'mainnet-beta';
  const rpcConfigured = Boolean(readEnv('SOLANA_RPC_URL', 'RANKED_TOKEN_HOLD_RPC_URL'));

  return { mintAddress, symbol, cluster, rpcConfigured };
}
