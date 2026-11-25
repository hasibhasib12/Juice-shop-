export type RetryableDatabaseError = { code?: unknown };

export function isSerializationConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as RetryableDatabaseError).code === "P2034");
}

export async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  const attempts = Math.max(1, Math.min(5, Math.floor(maxAttempts)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationConflict(error) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}
