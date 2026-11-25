# Development setup and security

## Preview-only environment

The POS development branch is `feature/pos-foundation`. Do not apply migrations, seed data, or run test sales against a database shared with Production.

Required Preview environment variables:
- `DATABASE_URL`: a dedicated Neon branch for Preview, separate from Production.
- `POS_SESSION_SECRET`: random secret of at least 32 characters for signed staff sessions.
- `POS_SETUP_KEY`: one-time key used to create the first owner account.

Optional seed-based owner provisioning:
- `POS_OWNER_NAME`
- `POS_OWNER_EMAIL`
- `POS_OWNER_PASSWORD` (minimum 12 characters)

## First-time setup

1. Confirm the Preview `DATABASE_URL` points to a dedicated non-production Neon branch.
2. Apply the Prisma migration with `npm run db:migrate`.
3. Seed the demo catalogue with `npm run db:seed`.
4. Open `/setup` on the Preview deployment and use the one-time setup key to create the first owner account. The setup endpoint refuses to create another owner after any user exists.
5. Sign in from the POS header.

The one-time setup key and session secret must never be committed to Git. Disable or rotate `POS_SETUP_KEY` after owner creation.

## Checkout behavior

The checkout API requires a signed-in active staff account. It accepts only cash payments, reads current product prices from PostgreSQL, rejects unavailable products and mixed currencies, records the order and payment in one serializable transaction, and writes an audit event. An idempotency key protects against duplicate submissions.

Card processing, tax configuration, discounts with manager approval, receipt printing, shift reconciliation, recipe-based stock deduction, and reporting are not yet complete. The interface must remain marked preview-only until those workflows are implemented and tested.
