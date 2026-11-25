export function rateLimitPolicy(attempts: number, maxAttempts: number, windowStartedAt: Date, windowSeconds: number, now = Date.now()) {
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStartedAt.getTime() + windowSeconds * 1000 - now) / 1000));
  return { allowed: attempts <= maxAttempts, retryAfterSeconds, remaining: Math.max(0, maxAttempts - attempts) };
}
