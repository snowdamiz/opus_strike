export function isPrismaUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002';
}

export async function readSingletonAfterUniqueRace<T>(
  createOrRead: () => Promise<T>,
  readExisting: () => Promise<T | null>
): Promise<T> {
  try {
    return await createOrRead();
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) throw error;

    const existing = await readExisting();
    if (existing) return existing;
    throw error;
  }
}
