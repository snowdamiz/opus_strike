import crypto from 'crypto';
import type { Request } from 'express';
import type { AuthAccountIdentity } from './types';

const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_CURRENT_USER_URL = 'https://discord.com/api/users/@me';

interface DiscordConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

interface DiscordTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface DiscordUserResponse {
  id?: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
  discriminator?: string;
  email?: string | null;
}

export class DiscordOAuthError extends Error {
  constructor(
    public readonly reason: string,
    message = 'Discord authentication failed'
  ) {
    super(message);
    this.name = 'DiscordOAuthError';
  }
}

function getForwardedProtocol(req: Request): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string' && forwardedProto.length > 0) {
    return forwardedProto.split(',')[0]?.trim() || req.protocol;
  }

  return req.protocol;
}

function getDefaultRedirectUri(req: Request): string {
  const protocol = getForwardedProtocol(req);
  return `${protocol}://${req.get('host')}/auth/discord/callback`;
}

function getConfiguredScopes(): string[] {
  const configuredScopes = process.env.DISCORD_OAUTH_SCOPES
    ?.split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const scopes = configuredScopes?.length ? configuredScopes : ['identify'];
  return scopes.includes('identify') ? scopes : ['identify', ...scopes];
}

export function getDiscordConfig(req: Request): DiscordConfig {
  return {
    enabled: process.env.DISCORD_AUTH_ENABLED !== 'false',
    clientId: process.env.DISCORD_CLIENT_ID ?? '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
    redirectUri: process.env.DISCORD_REDIRECT_URI ?? getDefaultRedirectUri(req),
    scopes: getConfiguredScopes(),
  };
}

export function assertDiscordConfigured(config: DiscordConfig): void {
  if (!config.enabled) {
    throw new DiscordOAuthError('disabled', 'Discord authentication is disabled');
  }

  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new DiscordOAuthError('not_configured', 'Discord authentication is not configured');
  }
}

export function createDiscordAuthorizationUrl(config: DiscordConfig, state: string): string {
  assertDiscordConfigured(config);

  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeDiscordCode(options: {
  config: DiscordConfig;
  code: string;
}): Promise<string> {
  assertDiscordConfigured(options.config);

  const body = new URLSearchParams({
    client_id: options.config.clientId,
    client_secret: options.config.clientSecret,
    grant_type: 'authorization_code',
    code: options.code,
    redirect_uri: options.config.redirectUri,
  });

  const response = await fetch(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  const payload = await response.json().catch(() => ({})) as DiscordTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new DiscordOAuthError(payload.error ?? 'token_exchange_failed');
  }

  return payload.access_token;
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUserResponse> {
  const response = await fetch(DISCORD_CURRENT_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  const payload = await response.json().catch(() => ({})) as DiscordUserResponse;
  if (!response.ok || !payload.id) {
    throw new DiscordOAuthError('identity_fetch_failed');
  }

  return payload;
}

function getDiscordAvatarUrl(user: DiscordUserResponse): string | null {
  if (!user.id || !user.avatar) return null;

  const extension = user.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`;
}

function hashEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return crypto
    .createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('hex');
}

export function mapDiscordUserToIdentity(user: DiscordUserResponse): AuthAccountIdentity {
  if (!user.id) {
    throw new DiscordOAuthError('identity_missing_id');
  }

  return {
    provider: 'discord',
    providerAccountId: user.id,
    displayName: user.global_name || user.username || null,
    avatarUrl: getDiscordAvatarUrl(user),
    emailHash: hashEmail(user.email),
  };
}
