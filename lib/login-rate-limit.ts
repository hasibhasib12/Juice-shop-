import "server-only";

import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 8;

function loginAttemptKey(email: string) {
  const secret = process.env.POS_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("POS_SESSION_SECRET must contain at least 32 characters");
  return createHmac("sha256", secret).update(email.toLowerCase().trim()).digest("hex");
}

export async function checkLoginRateLimit(email: string) {
  const key = loginAttemptKey(email);
  const rows = await prisma.$queryRaw<{ attempts: number; windowStartedAt: Date }[]>`
    INSERT INTO "LoginAttempt" ("key", "attempts", "windowStartedAt", "updatedAt")
    VALUES (${key}, 1, NOW(), NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE
        WHEN "LoginAttempt"."windowStartedAt" <= NOW() - make_interval(mins => 15) THEN 1
        ELSE "LoginAttempt"."attempts" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "LoginAttempt"."windowStartedAt" <= NOW() - make_interval(mins => 15) THEN NOW()
        ELSE "LoginAttempt"."windowStartedAt"
      END,
      "updatedAt" = NOW()
    RETURNING "attempts", "windowStartedAt"
  `;
  const attempt = rows[0];
  const retryAfterSeconds = Math.max(1, Math.ceil(
    (attempt.windowStartedAt.getTime() + WINDOW_MINUTES * 60_000 - Date.now()) / 1000,
  ));
  return {
    allowed: attempt.attempts <= MAX_ATTEMPTS,
    retryAfterSeconds,
    remaining: Math.max(0, MAX_ATTEMPTS - attempt.attempts),
  };
}

export async function clearLoginRateLimit(email: string) {
  await prisma.loginAttempt.deleteMany({ where: { key: loginAttemptKey(email) } });
}
