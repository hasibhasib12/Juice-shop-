# Juice Shop POS — Completion Plan

## Release rules
- All development stays on \`feature/pos-foundation\`.
- Never modify \`main\` or the production Neon branch during development.
- Do not deploy during development. A preview/production release requires completed acceptance checks and explicit owner approval.
- Card payment provider is intentionally deferred; cash and manual OTHER tender remain supported.
- Initial defaults are Afghanistan / AFN / Asia-Kabul, with worldwide configuration. Never assume a tax rate.

## Scope
Staff-facing POS only: catalogue, checkout, orders, tables, staff, inventory, suppliers/purchasing, shifts, refunds/returns, reports, receipts, hardware compatibility, security and operational reliability. No customer app, delivery marketplace or online ordering.

## Implemented
- [x] Next.js 15 / React 19 / TypeScript POS and Prisma/PostgreSQL backend.
- [x] Isolated Neon development branch and preview database configuration; production branch remains untouched.
- [x] Owner/manager/cashier authentication, scrypt password hashing, secure HMAC HttpOnly sessions, session versioning, login throttling, one-time owner setup and audited manager/owner staff password resets.
- [x] Owner-configurable staff permissions for reports, inventory, purchasing, refunds and table administration, enforced in server APIs.
- [x] Product/category CRUD, SKU, currency/price, variants, variant recipes, modifier groups/options, availability and archive controls.
- [x] POS product search now matches product name and SKU. Keyboard-wedge barcode scanners that type a code into the focused search field are supported by the same flow; physical scanner acceptance remains outstanding.
- [x] Product image upload implementation: JPEG/PNG/WebP signature validation, 5 MB limit, unique object keys, manager/owner authorization, audit events and Neon Object Storage integration. The \`pos-product-images\` bucket and scoped development-branch storage credentials are configured for the Preview environment only.
- [x] Cash and split cash/manual OTHER checkout, server-calculated totals, cash received/change, idempotency fingerprints, open-shift enforcement and atomic stock deduction.
- [x] Draft orders, order notes/customer name, order history, reprints and receipt refund history.
- [x] Tables, order assignment/transfer and permission enforcement.
- [x] Ingredient inventory, recipes, stock movements, waste/count adjustments, suppliers, purchase orders, partial receiving, weighted-average costs, supplier invoices and partial supplier payments.
- [x] Serializable purchasing transactions now retry Prisma serialization conflicts with bounded retries; unit tests cover retry and failure behavior.
- [x] Full/partial refunds and item-level return records with audit history.
- [x] Shift open/close, paid-in/out, cash reconciliation and shift CSV export.
- [x] Sales, staff, shift and stock valuation CSV reports; timezone-aware sales periods and currency-separated staff reporting.
- [x] Server-generated sales PDF export at \`/api/reports/pdf\`, alongside browser print layouts. The server PDF groups totals by currency.
- [x] Thermal receipt print stylesheet targets 80 mm paper using the browser print dialog.

## Remaining implementation and acceptance
- [ ] Finish and validate server PDF exports for staff and shift reports; sales PDF is implemented.
- [ ] Run an actual image upload against the isolated Preview environment and verify image display on POS cards. Code and Preview-only storage configuration are present; no Preview deployment has been performed.
- [ ] Test supported barcode scanner models and receipt printers physically. Browser keyboard-wedge scanning and 80 mm print layout are compatibility foundations, not proof of every device model.
- [ ] Add automated API/integration tests for concurrent checkout, refunds, inventory stock races, supplier invoice/payment races, draft conversion and shift reconciliation.
- [ ] Review all write APIs for consistent authorization, input validation, rate limits, CSRF/session behavior and audit coverage.
- [ ] Complete responsive desktop/tablet/mobile and accessibility acceptance.
- [ ] Complete Neon backup/restore rehearsal on a disposable development branch and document recovery steps.
- [ ] Test empty/loading/error states, failure recovery and multi-cashier concurrency.
- [ ] Perform full POS acceptance with realistic products, recipes, suppliers, taxes, shifts and refunds.
- [ ] Complete production readiness review and obtain explicit owner approval before any deployment or production migration.

## Deferred by owner
- [x] Card payment gateway/terminal integration is intentionally deferred. Manual OTHER tender is not a card gateway.
- [ ] Tax-inclusive pricing and jurisdiction-specific tax rules require the actual legal business location and accounting rules.
- [ ] Finished-product restocking requires a finished-goods inventory model; returned prepared drinks are recorded as waste and sealed goods are not restocked automatically.

## Release gates
1. All remaining implementation and tests above completed.
2. CI passes Prisma validation, lint, unit tests, TypeScript and production build on the final branch head.
3. Development-branch migrations, storage uploads, backup and restore are verified without touching production.
4. Owner performs preview acceptance after an approved preview deployment.
5. No production deployment or production database migration without explicit approval.
