# Neon POS backup and restore rehearsal

## Purpose and safety boundary

This runbook is for a controlled point-in-time recovery (PITR) rehearsal using a disposable child branch. It must never target the production branch.

Known project resources:
- Neon project: `red-violet-10765375`
- Production branch (DO NOT RESTORE, RESET, MIGRATE OR WRITE): `br-rapid-shadow-bg1x6iv4`
- Isolated Preview development branch: `br-tiny-smoke-bgx9wb8z`
- Existing disposable clone rehearsal branch: `br-autumn-sunset-bghhurfa` (`juice-shop-pos-restore-rehearsal-20261125`), scheduled to expire on 2026-11-26 at 11:40 UTC.

The clone rehearsal previously confirmed the child branch had the same schema object tree and read-only row counts as its source. That is a branch-clone verification, not proof of PITR recovery.

## Why the PITR rehearsal is still open

Neon Instant Restore supports root and child branches, including restoring a branch to its own history. The available connected Neon actions in this workspace expose snapshots and snapshot restores, but do not expose the self-history branch restore operation. Manual snapshots are not available on this child branch. Do not work around that by snapshotting or restoring production.

The restore must therefore be run by an authorized operator in the Neon Console (or Neon CLI/API with the correct project and branch IDs). Official instructions: https://neon.com/docs/postgres/backup-restore/branch-restore

## Controlled rehearsal procedure

1. Confirm the target is the disposable branch `br-autumn-sunset-bghhurfa`, not `br-tiny-smoke-bgx9wb8z` and never `br-rapid-shadow-bg1x6iv4`.
2. If the existing rehearsal branch has expired, create a new disposable child branch from `br-tiny-smoke-bgx9wb8z` with a short expiry (24–48 hours). Do not create it from production.
3. Connect to the disposable branch and record its branch ID, database name, timestamp, schema object count, and a small set of non-sensitive row counts.
4. On that disposable branch only, create a uniquely named temporary probe table and insert a sentinel row. Record the exact UTC timestamp immediately before and after the write. Do not use real customer or staff data.
5. In Neon Console, select the disposable branch and open **Postgres database → Backup & Restore → Restore**.
6. Choose **From history**, select a timestamp just before the sentinel table was created, and review the target branch ID carefully before confirming.
7. Neon should preserve the pre-restore branch state in an automatically created `<branch>_old_<timestamp>` backup branch. Do not finalize or swap any branch into production.
8. After restore, reconnect to the disposable branch and verify:
   - the sentinel table is absent (it did not exist at the selected point);
   - the expected pre-probe schema and row counts are present;
   - Prisma can connect and read the expected tables;
   - the original post-probe state remains available in the automatically created backup branch.
9. Record screenshots or operation IDs, selected restore timestamp, source/target branch IDs, verification queries and result, operator, and date/time.
10. Allow the disposable branch and its backup branch to expire or delete them only after confirming they have no child branches and are no longer needed.

## Acceptance criteria

- [ ] PITR restore executed against a disposable child branch only.
- [ ] Restore timestamp is recorded and predates the sentinel write.
- [ ] Restored branch is verified against the expected earlier schema and row counts.
- [ ] Automatically preserved pre-restore state is verified in the backup branch.
- [ ] Application connection and basic read smoke test pass after restore.
- [ ] Production branch ID and state are confirmed unchanged.
- [ ] Recovery operator and evidence are recorded.

Until all items are checked by the operator, PITR remains **not rehearsed**. A successful branch clone, migration test, or CI run does not satisfy this acceptance gate.
