// Dev-only: seed a local user and print an auth_token cookie for UI testing.
// Usage: pnpm --filter @voxel-strike/server exec tsx src/scripts/seed-dev-session.ts
import prisma from '../db';
import { createAuthToken } from '../auth/session';

async function main() {
  const name = 'UITester';
  const user = await prisma.user.upsert({
    where: { name },
    update: { lastLoginAt: new Date(), tutorialCompletedAt: new Date() },
    create: {
      name,
      lastLoginAt: new Date(),
      tutorialCompletedAt: new Date(),
      authAccounts: {
        create: {
          provider: 'discord',
          providerAccountId: 'dev-ui-tester',
          displayName: 'UITester',
        },
      },
    },
  });

  const token = createAuthToken({ userId: user.id, provider: 'discord' });
  console.log(JSON.stringify({ userId: user.id, token }));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
