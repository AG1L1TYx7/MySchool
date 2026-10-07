/** Retries a database write that lost a deadlock or write conflict (Prisma P2034), which happens when suites run in parallel. */
export async function retryWrite<T>(
  fn: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const code = (err as { code?: string }).code;
      if (code !== 'P2034') throw err;
      await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
  }
  throw last;
}
