ALTER TABLE "User" ADD COLUMN "permissionOverrides" JSONB NOT NULL DEFAULT '{}'::jsonb;
