# Juice Shop POS — Completion Plan

## Release rule
The application is a preview prototype until every release gate below is implemented, deployed to preview, and tested. Never use production for development. Keep all work on `feature/pos-foundation`; do not merge to `main` or promote a production deployment without explicit approval.

## Product scope
One staff-facing POS for the Juice Shop. No customer ordering app, delivery marketplace, or unrelated modules. Preserve the approved pomegranate visual design and the reference layout while adding real functionality.

## Current verified baseline
- Next.js 15 / React 19 / TypeScript application.
- Product list is hard-coded in `app/page.tsx`.
- Search and category filtering run in browser state.
- Cart quantities, sample discount, subtotal, and hard-coded 10% tax are client-side only.
- Payment, order saving, printer, authentication, inventory, staff roles, cash management, and reports are not implemented.
- There is no configured database or payment provider evidenced in the current repository files.
- The current cashier identity and date/time in the UI are static sample values.
- Do not treat preview interactions or sample totals as real business operations.

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
- [ ] Database provider and production connection configured securely.
- [ ] Migrations for users, roles, permissions, categories, products, variants, modifiers, recipes, ingredients, stock movements, orders, order lines, payments, refunds, shifts, cash movements, discounts, customers, settings, and audit logs.
- [ ] Seed/demo data clearly separated from real business data.
- [ ] Server-side validation, authorization, transactional services, and error handling.
- [ ] Automated unit/integration tests for critical calculations and transaction rollback.

## Milestone 2 — Catalogue and checkout
- [ ] Admin product/category CRUD, image management, availability, sizes, variants, extras, and price rules.
- [ ] Real search/filter and cart persisted against server-created order drafts.
- [ ] Table/customer/order notes, discounts with permissions, configurable tax and totals.
- [ ] Atomic order finalization with unique receipt/order number and immutable line-price snapshots.

## Milestone 3 — Payments and receipts
- [ ] Cash tender, received amount, change due, and cash payment record.
- [ ] Card payment integration with a selected provider/terminal; verified webhook/callback handling.
- [ ] Split tender, failed/voided payments, refunds, reconciliation, and idempotency.
- [ ] Printable receipt layout, thermal printer/browser print support, reprints, and receipt numbering.

## Milestone 4 — Inventory
- [ ] Ingredient units, recipes/BOM, modifiers, stock receiving and adjustments.
- [ ] Deduct recipe quantities only when an order is successfully paid/closed, in the same transaction.
- [ ] Wastage, stock counts, low-stock thresholds, supplier/purchase records if required.
- [ ] Inventory ledger and audit trail.

## Milestone 5 — Staff, shifts, cash and reports
- [ ] Admin/manager/cashier login and least-privilege permissions.
- [ ] Discount/refund/void approval rules and activity history.
- [ ] Shift open/close, opening float, paid-in/out, expected cash, counted cash, variance.
- [ ] Daily/weekly/monthly sales, product mix, tax, tender, refunds, stock and staff reports.

## Milestone 6 — Hardening and release
- [ ] Responsive usability, accessibility, empty/loading/error states.
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
