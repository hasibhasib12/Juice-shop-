import "server-only";
import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { rateLimitPolicy } from "@/lib/rate-limit-policy";
export async function checkActionRateLimit(scope: string, identity: string, maxAttempts: number, windowSeconds: number) {
  const secret = process.env.POS_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("POS_SESSION_SECRET must contain at least 32 characters");
  if (!scope || !identity || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) throw new Error("Invalid rate-limit policy");
  const key = createHmac("sha256", secret).update("action:" + scope + ":" + identity).digest("hex");
  const rows = await prisma.$queryRaw<{ attempts: number; windowStartedAt: Date }[]>`
    INSERT INTO "LoginAttempt" ("key", "attempts", "windowStartedAt", "updatedAt")
    VALUES (${key}, 1, NOW(), NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE WHEN "LoginAttempt"."windowStartedAt" <= NOW() - (${windowSeconds} * INTERVAL '1 second') THEN 1 ELSE "LoginAttempt"."attempts" + 1 END,
      "windowStartedAt" = CASE WHEN "LoginAttempt"."windowStartedAt" <= NOW() - (${windowSeconds} * INTERVAL '1 second') THEN NOW() ELSE "LoginAttempt"."windowStartedAt" END,
      "updatedAt" = NOW()
    RETURNING "attempts", "windowStartedAt"
  `;
  const attempt = rows[0];
  return rateLimitPolicy(attempt.attempts, maxAttempts, attempt.windowStartedAt, windowSeconds);
}
