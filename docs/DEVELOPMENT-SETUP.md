# Development setup and security

## Preview-only environment

The POS development branch is `feature/pos-foundation`. Do not apply migrations, seed data, or run test sales against a database shared with Production.

Verified Preview resources:
- Vercel project: `juice-shop-pos`.
- Git branch: `feature/pos-foundation`.
- Neon development branch: `juice-shop-preview-development` (`br-tiny-smoke-bgx9wb8z`).
- Seeded catalogue: 4 categories and 10 sample products.
- The original Neon `production` branch and Vercel Production environment have not been changed.

Required Preview environment variables:
- `DATABASE_URL`: dedicated Neon Preview branch, separate from Production.
- `POS_SESSION_SECRET`: random secret of at least 32 characters for signed staff sessions.
- `POS_SETUP_KEY`: one-time key used to create the first owner account.

Optional seed-based owner provisioning:
- `POS_OWNER_NAME`
- `POS_OWNER_EMAIL`
- `POS_OWNER_PASSWORD` (minimum 12 characters)

## First-time setup

1. Confirm Preview `DATABASE_URL` points to the dedicated Neon development branch.
2. Apply the Prisma migration with `npm run db:migrate`.
3. Seed the demo catalogue with `npm run db:seed`.
4. Open `/setup` on the Preview deployment and use the Preview `POS_SETUP_KEY` to create the first owner account. The setup endpoint refuses to create another first owner after any user exists.
5. Sign in from the POS header.
6. The owner can create staff accounts at `/staff`, configure store and tax settings at `/settings`, and add real menu items at `/catalog`.

The development database currently has no staff users, orders, ingredients, or recipes. Create the owner before testing authenticated management features. The one-time setup key and session secret must never be committed to Git. Rotate or remove `POS_SETUP_KEY` after owner creation.

## POS workflows currently implemented

- Database-backed product catalogue with manager/owner create, edit, availability, archive, category creation and HTTPS image URL support.
- Staff sign-in and manager/owner staff directory with cashier account creation and account activation/deactivation.
- Cash shift open/close screen; cash checkout is blocked unless the cashier has an open shift.
- Cash-only checkout with server-side product price validation, configurable tax-exclusive rate, idempotency, audit event, and serializable transaction.
- Ingredient creation, stock receipts, waste, stock counts/adjustments, reorder thresholds, and recipe mapping.
- Recipe ingredients are deducted atomically with the cash order; insufficient stock rejects the sale and rolls back the transaction.
- Authenticated order history and printable/reprintable receipt view.
- Daily, weekly and monthly sales summaries using the configured store timezone.
- Owner-configurable country, currency, locale, timezone, tax label and tax rate. Initial defaults are Afghanistan / AFN / Asia-Kabul / 0% tax.

## Still incomplete — do not use for live sales

- Card terminal/payment provider, split tender, payment callbacks and refunds/voids.
- Manager-authorized discounts, promotions, customer accounts, tables and order notes.
- Tax-inclusive pricing, jurisdiction-specific tax treatment, receipt business identity/customization and direct printer integration.
- Ingredient purchasing/suppliers, stock valuation, and stock reports.
- Paid-in/out cash movements, full shift reporting and export.
- Fine-grained permissions, password change/reset, rate limiting and security review.
- Automated integration/end-to-end tests, backup/restore verification, accessibility and owner acceptance testing.

The app must remain marked preview-only until the remaining release gates are implemented and tested. Never promote to Production without explicit owner approval.
