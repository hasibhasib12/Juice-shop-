CREATE TYPE "StaffApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "User"
  ADD COLUMN "approvalStatus" "StaffApprovalStatus" NOT NULL DEFAULT 'APPROVED';
