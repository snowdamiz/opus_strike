import { PrismaClient } from '@prisma/client';

// Create a singleton PrismaClient instance
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function shouldLogPrismaQueries(): boolean {
  const value = process.env.PRISMA_LOG_QUERIES?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function getPrismaLogLevels(): Array<'query' | 'warn' | 'error'> {
  const levels: Array<'query' | 'warn' | 'error'> = process.env.NODE_ENV === 'production'
    ? ['error']
    : ['error', 'warn'];

  if (shouldLogPrismaQueries()) levels.unshift('query');
  return levels;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: getPrismaLogLevels(),
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
