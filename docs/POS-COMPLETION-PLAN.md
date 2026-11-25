# Juice Shop POS — Completion Plan

## Release rule
The application is a preview prototype until every release gate below is implemented, deployed to preview, and tested. Never use production for development. Keep all work on `feature/pos-foundation`; do not merge to `main` or promote a production deployment without explicit approval.

## Product scope
One staff-facing POS for the Juice Shop. No customer ordering app, delivery marketplace, or unrelated modules. Preserve the approved pomegranate visual design and the reference layout while adding real functionality.

## Current verified baseline
- Next.js 15 / React 19 / TypeScript application with the approved pomegranate POS layout.
- PostgreSQL/Neon is connected to the application, but the current Vercel Preview and Production database environment variables share the same integration values. No migration or seed has been run because a separate Preview database branch has not yet been verified.
- Prisma schema, initial SQL migration, repeatable catalogue seed, and database health endpoint are committed.
- Product API reads active categories/products from PostgreSQL; the UI falls back to clearly labelled demo cards only if the live catalogue cannot be loaded.
- Manager/owner catalogue APIs and a branded `/catalog` management screen now support creating, editing, hiding, and archiving products, adding categories, HTTPS image URLs, SKU, currency and price updates. Writes are audited.
- Store country, currency, timezone and locale have Afghanistan / AFN / Asia-Kabul defaults and an owner-only settings API.
- Staff authentication foundation is implemented with scrypt password hashes, HMAC-signed HttpOnly sessions, login/logout/session endpoints, and a one-time first-owner setup page/API.
- Checkout API currently supports cash only. It validates current database product prices, records order lines/payment/audit event transactionally, and uses idempotency keys. The UI calls this API only for real database product IDs.
- Authenticated order history/detail APIs and cash shift open/close/reconciliation APIs are present.
- The POS remains preview-only. Card processing, tax configuration, inventory deduction, printer workflow, manager discount approval, full shift UI, reports, and automated end-to-end tests are not complete.

## Target architecture
- PostgreSQL as the authoritative relational store; schema and migrations committed to the repository.
- Server-side business services for products, orders, payments, stock movements, shifts, discounts, and reports.
- Atomic database transactions for order completion, payment recording, and ingredient deduction.
- Server-side validation for every write; money stored as integer minor units or exact decimal values, never floating-point arithmetic.
- Authentication with password hashing, secure sessions, role/permission checks, and audit events.
- Idempotency keys for checkout/payment callbacks to prevent duplicate orders or charges.
- Configurable currency, tax rates, receipt details, timezone, and rounding rules. AFN can be the initial display currency, but tax must not be assumed to be 10%.
- Provider-specific card terminal integration only after the merchant selects and configures a supported provider. Never store raw card data.
- Cash payments can be implemented independently of a card provider.

## Milestone 1 — Data and business foundation
- [x] Neon PostgreSQL provisioned and connectivity endpoint verified.
- [x] Initial Prisma schema/migration and repeatable demo catalogue seed committed.
- [x] Create a dedicated Neon Preview branch and point Preview DATABASE_URL to it; apply migration and verify seeded catalogue.
- [ ] Expand schema for variants, modifiers, refunds, cash movements, discounts and customers.
- [x] Server-side validation, staff authentication, owner-only settings, cash checkout transaction and audit events added.
- [ ] Automated unit/integration tests for critical calculations and transaction rollback.

## Milestone 2 — Catalogue and checkout
- [x] Basic admin product create/edit/archive, category create, HTTPS image URL, SKU, availability, and price editing.
- [ ] Category rename/archive, image upload/storage, sizes, variants, extras, modifier pricing, and price rules.
- [x] Database-backed catalogue API, search/filter, cart and server-priced cash checkout foundation.
- [ ] Server-created draft orders, tables/customer/order notes, discounts with permissions, configurable tax and totals.
- [x] Atomic cash order finalization with unique order number, line-price snapshots and idempotency key.

## Milestone 3 — Payments and receipts
- [x] Cash payment record and transactional order completion (cash received/change due UI still pending).
- [ ] Card payment integration with a selected provider/terminal; verified webhook/callback handling.
- [ ] Split tender, failed/voided payments, refunds, reconciliation, and idempotency.
- [ ] Printable receipt layout, thermal printer/browser print support, and reprints (order number is generated).

## Milestone 4 — Inventory
- [x] Ingredient units, product recipe/BOM links, stock receiving, waste and count adjustments with stock movement ledger and audit events.
- [x] Deduct configured recipe quantities only when a cash order completes, in the same transaction as order/payment creation; reject insufficient stock and roll back.
- [x] Low-stock thresholds and waste/count adjustment movements.
- [ ] Supplier and purchase-order records if required.
- [x] Inventory movement ledger and audit trail.

## Milestone 5 — Staff, shifts, cash and reports
- [x] Owner/manager/cashier roles in schema and staff sign-in/session foundation.
- [x] Manager/owner staff directory, cashier creation, account activation/deactivation, and owner-controlled role assignment.
- [ ] Fine-grained permissions and discount/refund/void approval rules; password reset/change workflow.
- [x] Shift open/close APIs with opening float, expected cash, counted cash and variance.
- [x] Cash shift open/close UI, checkout shift enforcement, expected cash and counted-cash variance calculation.
- [ ] Paid-in/out, shift-to-order association, and shift report export.
- [x] Daily/weekly/monthly sales, product mix, average order and tender summary API/UI using configured store timezone.
- [ ] Tax, refunds, stock valuation, staff performance reports and CSV/PDF export.

## Milestone 6 — Hardening and release
- [ ] Responsive usability, accessibility, empty/loading/error states and full UI acceptance testing.
- [ ] Security review, rate limiting, CSRF/session protections, secrets handling, backup/restore test.
- [ ] Automated tests for concurrent checkout, duplicate requests, refunds, stock race conditions, and shift reconciliation.
- [ ] Preview acceptance test with the owner using realistic sample data.
- [ ] Production readiness checklist and explicit owner approval before any production release.

## Decisions that must be configured before live use
1. PostgreSQL hosting/provider and credentials.
2. Legal business location, tax rules, receipt/business identity, timezone, and currency settings.
3. Card terminal/payment provider and merchant credentials, if card payments are required.
4. Receipt printer model/connection method, if direct thermal printing is required.
5. Actual menu, prices, sizes, extras, recipes, and ingredient units.

## Non-negotiable acceptance criteria
A sale is complete only when the server has validated the order, calculated totals from trusted settings, recorded payment, deducted stock exactly once, and committed all related records atomically. A failed step must roll back safely. Reports must reconcile to the underlying order/payment ledger. No demo-only control may be presented as a working business operation.
