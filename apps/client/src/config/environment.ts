// Environment configuration for server endpoints

const isDev = import.meta.env.DEV;
const isProd = import.meta.env.PROD;

// Server URL configuration
const DEV_SERVER_URL = 'ws://localhost:2567';
const PROD_SERVER_URL = import.meta.env.VITE_SERVER_URL || 'wss://voxel-strike.example.com';

export const config = {
  serverUrl: isDev ? DEV_SERVER_URL : PROD_SERVER_URL,
  discordAuthEnabled: import.meta.env.VITE_DISCORD_AUTH_ENABLED !== 'false',
  isDev,
  isProd,
} as const;

export type Config = typeof config;
