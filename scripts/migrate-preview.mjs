import { execFileSync } from "node:child_process";

// Database migrations are a deliberate release operation, not a side effect of
// building a Preview. The failed Preview migration must be reviewed and
// recovered explicitly before migrations are enabled again.
if (process.env.VERCEL_ENV === "preview" && process.env.APPLY_PREVIEW_MIGRATIONS !== "1") {
  console.log("Skipping Preview database migrations; set APPLY_PREVIEW_MIGRATIONS=1 only after migration recovery.");
  process.exit(0);
}

if (process.env.VERCEL_ENV !== "preview") {
  console.log("Skipping automatic database migration outside Vercel Preview.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to apply Preview migrations.");
}

console.log("Applying explicitly enabled Prisma migrations to the configured Preview database only.");
execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: process.env });
