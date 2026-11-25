import { execFileSync } from "node:child_process";

if (process.env.VERCEL_ENV !== "preview") {
  console.log("Skipping automatic database migration outside Vercel Preview.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to apply Preview migrations.");
}

console.log("Applying Prisma migrations to the configured Preview database only.");
execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: process.env });
