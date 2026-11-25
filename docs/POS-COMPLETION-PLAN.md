# Juice Shop POS — Completion Plan

## Release rules
- All development stays on \`feature/pos-foundation\`.
- Never modify \`main\` or the production Neon branch during development.
- No deployment during development. A preview/production release requires completed acceptance checks and explicit owner approval.
- Card payment provider is intentionally deferred; cash and manual OTHER tender remain supported.
- Initial defaults are Afghanistan / AFN / Asia-Kabul, with worldwide configuration. Never assume a tax rate.

## Scope
Phase 0 is the current priority: complete and accept the staff-facing POS. The owner has expanded the product roadmap to include kitchen display, waiter operations, QR self-service table ordering, expanded floor management, delivery dispatch, customer loyalty, finance, advanced inventory, workforce management, multi-branch operations, optional online ordering and AI business intelligence. These are future phases and must not be described as implemented until delivered and accepted. See `docs/PRODUCT-ROADMAP.md`.

## Implemented
- [x] Next.js 15 / React 19 / TypeScript POS and Prisma/PostgreSQL backend.
- [x] Isolated Neon development branch and preview database configuration; production branch remains untouched.
- [x] Owner/manager/cashier authentication, scrypt password hashing, secure HMAC HttpOnly sessions, session versioning, login throttling, one-time owner setup and audited manager/owner staff password resets.
- [x] Owner-configurable staff permissions for reports, inventory, purchasing, refunds and table administration, enforced in server APIs.
- [x] Database-backed action rate limits for checkout, refunds, item returns, supplier invoice/payment writes, purchase orders, inventory movements, shift open/close and cash-drawer movements, catalogue/product/category writes, supplier writes, staff writes, password resets and product image uploads. Rate-limit identities are HMAC hashed and 429 responses include Retry-After.
- [x] Product/category CRUD, SKU, currency/price, variants, variant recipes, modifier groups/options, availability and archive controls.
- [x] POS search matches product names and SKU. Keyboard-wedge scanners can scan a product SKU and press Enter to add it directly to the cart; physical scanner model acceptance remains outstanding.
- [x] Product image upload implementation: JPEG/PNG/WebP signature validation, 5 MB limit, unique object keys, manager/owner authorization, audit events and Neon Object Storage integration. The \`pos-product-images\` bucket and scoped development-branch storage credentials are configured for the Preview environment only.
- [x] Cash and split cash/manual OTHER checkout, server-calculated totals, cash received/change, idempotency fingerprints, open-shift enforcement and atomic stock deduction.
- [x] Draft orders, order notes/customer name, order history, reprints and receipt refund history.
- [x] Tables, order assignment/transfer and permission enforcement.
- [x] Ingredient inventory, recipes, stock movements, waste/count adjustments, suppliers, purchase orders, partial receiving, weighted-average costs, supplier invoices and partial supplier payments.
- [x] Serializable checkout, refunds and purchasing transactions retry Prisma serialization conflicts with bounded retries; tests cover retry, non-retryable failures and exhaustion. Stock deductions use conditional database updates inside the serializable checkout transaction.
- [x] Full/partial refunds and item-level return records with audit history.
- [x] Shift open/close, paid-in/out, cash reconciliation and shift CSV export. Cash paid-in/out calculations attribute refunds to the exact shift via refund.shiftId; shift exports fetch refunds in one query rather than querying once per shift.
- [x] Sales, staff, shift and stock valuation CSV reports; timezone-aware sales periods and currency-separated staff reporting.
- [x] Server-generated, paginated PDF exports for sales, staff and shift reports. Sales PDF totals are separated by currency.
- [x] Thermal receipt print stylesheet targets 80 mm paper using the browser print dialog.

## Remaining implementation and acceptance
- [ ] Deploy an approved Preview build and run an actual product image upload; verify the uploaded image renders on the POS product card. Code and Preview-only storage configuration are present, but no Preview deployment/upload acceptance has been performed.
- [ ] Test supported barcode scanner models and receipt printers physically. Keyboard-wedge scan-to-cart and 80 mm browser print layouts are implemented, not proof of every device model.
- [x] Add automated API/integration tests for login, checkout, duplicate checkout idempotency, concurrent refunds, concurrent item returns and invalid payment rejection against a real PostgreSQL-backed Next.js HTTP server. PostgreSQL concurrency tests also cover stock races, duplicate idempotency keys, partial refund races and shift cash reconciliation. Supplier invoice/payment races and draft conversion API scenarios remain additional coverage opportunities.
- [x] Add same-origin / Fetch Metadata checks to every current API mutation handler (POST, PUT, PATCH and DELETE), including checkout, refunds, returns, authentication, staff, catalogue, inventory, purchasing, shifts, tables, settings, drafts, discount authorization and image uploads. Unit tests cover same-origin, cross-origin, malformed-origin and missing-origin metadata cases.
- [ ] Complete the deeper endpoint-by-endpoint security review of session freshness, role/permission enforcement, object ownership, audit coverage and proxy/host-origin behavior. The origin guard permits non-browser clients with no Origin or Fetch Metadata; confirm this remains appropriate for the deployment threat model.
- [ ] Complete responsive desktop/tablet/mobile and accessibility acceptance.
- [ ] Complete a Neon backup/restore rehearsal on a disposable development branch and document recovery steps. Production remains untouched.
- [ ] Test empty/loading/error states, failure recovery and multi-cashier concurrency.
- [ ] Perform full POS acceptance with realistic products, recipes, suppliers, taxes, shifts and refunds.
- [ ] Complete production readiness review and obtain explicit owner approval before any deployment or production migration.

## Deferred by owner
- [x] Card payment gateway/terminal integration is intentionally deferred. Manual OTHER tender is not a card gateway.
- [ ] Tax-inclusive pricing and jurisdiction-specific tax rules require the actual legal business location and accounting rules.
- [ ] Finished-product restocking requires a finished-goods inventory model; returned prepared drinks are recorded as waste and sealed goods are not restocked automatically.
- [ ] Self-service email password recovery requires a selected email delivery provider. Owner/manager-assisted staff resets and self-service password change are implemented.

## Latest CI verification
Commit \`65a2db95bcc57cd7f8f2d0058a0e97eaadf0ad61\` passed GitHub Actions: Prisma validation, ESLint, 27 automated tests, TypeScript and production build. The later documentation update must also pass CI before this is considered the final verified head.

## Release gates
1. Complete remaining implementation and acceptance above.
2. CI passes Prisma validation, lint, unit tests, TypeScript and production build on the final branch head.
3. Development-branch migrations, storage uploads, backup and restore are verified without touching production.
4. Owner performs preview acceptance after an approved preview deployment.
5. No production deployment or production database migration without explicit approval.


## Latest security-hardening batch
- Commit `ab0cad702e58f9ec2ab387b9528970d35fe808d5` plus follow-up `83c1bf36a0efab54fb40f002f1a564331c6f14cb` updates recipe permission enforcement, recipe write rate limits, recipe input validation, store-settings write rate limits and settings request-body validation.
- The branch CI must pass on the latest head before this batch is considered verified.


## Additional mutation protection
- Commit `18f448b607097d224174363121fabba7d47d77f7` adds database-backed rate limits to product variant/modifier updates, manager discount authorization attempts, order draft create/update/delete, table-order assignment/transfer, and password changes.
- Rate limits use the existing HMAC-keyed LoginAttempt store and return HTTP 429 with Retry-After when exceeded.
- Latest code and documentation commits require CI verification; no deployment was performed.


## Verified progress — 2026-11-25
- Commit `255591541c587ba5c2a13c18829abb26ac55acc0` passed GitHub Actions run `45605257538`: Prisma validation, development CI migrations, ESLint, automated test suite (including PostgreSQL and HTTP API integration tests), TypeScript and production build.
- The API integration harness sends non-browser requests without Origin / Fetch Metadata headers; browser origin protection remains covered by dedicated unit tests. The broader threat-model decision about absent metadata is still open.
- A disposable child branch `juice-shop-pos-restore-rehearsal-20261125` was cloned from the isolated development branch and verified to contain an identical database object tree (106 objects) and matching read-only data counts (29 tables, 22 applied migrations, 10 products, 4 categories, 0 staff rows). It is set to expire automatically on 2026-11-26. This validates branch cloning, not point-in-time backup restoration.
- Neon rejected manual snapshot creation on the development child branch because manual snapshots are restricted to root branches. No production branch or data was changed. A true backup/restore rehearsal remains open and must use a supported isolated restore path; do not snapshot or restore production as a workaround.
- Responsive/accessibility code has keyboard focus-visible and reduced-motion support plus responsive breakpoints, but device/browser acceptance and screen-reader testing remain open.
- Image upload/render, physical scanner/printer tests, multi-cashier failure recovery, full business acceptance and final release approval remain open.

### Security review notes — 2026-11-25
- Session tokens are HMAC-SHA256 signed, HttpOnly, SameSite=Strict cookies with a 12-hour expiry. Every authenticated request reloads the user and checks active status plus the current sessionVersion, so staff deactivation and session-version increments invalidate existing sessions.
- Passwords use per-password random salts with scrypt; login attempts are rate limited.
- Checkout, refund and item-return routes validate origin metadata before authentication, require an authenticated actor, apply database-backed rate limits, validate request payloads and write audit records in their transaction paths.
- The origin helper rejects cross-origin and same-site browser requests when Fetch Metadata is present, rejects malformed/mismatched Origin values, and permits requests with both Origin and Fetch Metadata absent. This supports non-browser API clients; deployment must retain SameSite=Strict cookies and must not expose cookie-authenticated credentials to untrusted clients. Revisit before adding mobile or third-party API clients.
- Current POS is single-store/single-tenant. Per-branch object ownership and branch-scoped data authorization are not implemented; they are a mandatory gate before multi-branch rollout, not a claim of current branch isolation.
- This is a focused review of session handling and high-risk checkout/refund/return paths, not a completed endpoint-by-endpoint penetration test. Continue reviewing every mutation/read route, audit coverage and trusted-proxy host handling before production approval.

- Added `docs/POS-DEVICE-ACCEPTANCE.md` with repeatable scanner, 80 mm receipt printer, responsive/accessibility, and operational acceptance procedures. These procedures are prepared but remain untested on physical devices.


## Additional development — 2026-11-25
- Commit `5098d0a3f1952ef0c2434b339d4d2bad48ba642d` passed full CI run `45606262465`: Prisma validation, development migrations, lint, tests, TypeScript and production build.
- Category create/update/archive now share the catalogue mutation rate limit; owner permission changes are also rate limited.
- Supplier create/update and their audit events now commit atomically. Supplier list reads no longer consume the supplier-write rate limit.
- Initial owner setup rejects null, array and non-object JSON payloads instead of failing on property access.
- Table create/update now consistently enforce the configurable `MANAGE_TABLES` permission, apply database-backed rate limits, and persist create audit records atomically.
- The owner will perform physical scanner/printer tests and real-device acceptance personally. These remain open acceptance tasks until the owner reports results; development should continue independently.
- These newest security/reliability changes are on the feature branch and require a successful CI run on the final current head before being marked verified.


## Verified development — 2026-11-25 (currency and shift safeguards)
- Commit `27c8abec473e063095ec74f082478b9ed31334c1` passed GitHub Actions run `45625910744`: Prisma validation, development migrations, ESLint, automated tests, TypeScript and production build.
- Store currency changes are rejected while cashier shifts are open or purchase orders remain in DRAFT / PARTIALLY_RECEIVED states. The update is protected by a Serializable transaction with bounded retry handling.
- Shift opening captures the configured store currency in its `SHIFT_OPENED` audit event. Shift reconciliation CSV/PDF exports show that currency; legacy shifts without a snapshot are labelled UNKNOWN rather than guessed.
- Purchase order creation and receiving reject currencies that differ from the configured store currency. Currency conversion is intentionally not fabricated; a future FX workflow requires an explicit exchange-rate source and accounting policy.
- Integration coverage verifies currency changes are blocked while a shift is open and that the shift-opening audit event records the currency.
- No production database, production environment variables, or deployment were changed.


## Verified progress — cash reconciliation
- Commit `783a07df127242eb1e2b39c73364dd87e6b7ffcd` passed GitHub Actions run `45635966698`: Prisma validation, development migrations, lint, automated tests, TypeScript and production build.
- PostgreSQL integration coverage now verifies that a cash refund processed on a later cashier shift reduces the refunding drawer, not the original sale's drawer.
- A new PostgreSQL integration scenario has been added in commit `51c4a58333780b87b894a10011a12e07e1e6789d` to race two receipts of 6 units against a 10-unit purchase-order line. It asserts only one receipt succeeds, stock increases once, weighted-average cost is correct, and the PO line, status, movement ledger and audit trail agree. This newest test is pending CI verification.


## Verified progress — purchasing concurrency
- Commit `b2d699ad9f407547f210946fa8e6d8371d54ba24` passed GitHub Actions run `45637110572`: Prisma validation, development migrations, lint, automated tests, TypeScript and production build.
- PostgreSQL/API integration coverage verifies competing receipts cannot over-receive a purchase-order line; stock quantity, weighted-average cost, purchase-order status, stock movement and audit records remain consistent.
- Supplier invoice integration coverage verifies competing invoices cannot bill more than the received uninvoiced quantity.
- Supplier payment integration coverage verifies concurrent payments cannot overpay an invoice and that the payment, invoice status and audit record remain consistent.
- These checks ran in the isolated CI development database. No production database or environment was changed.


## Verified progress — purchasing and authorization
- Commit `b2d699ad9f407547f210946fa8e6d8371d54ba24` passed CI run `45637110572`, including Prisma validation, development migrations, lint, tests, TypeScript and production build. It verifies concurrent purchase receiving, duplicate supplier invoice quantity protection, and concurrent supplier payment overpayment protection.
- Commit `89461616847f51816d0c6c1a570096cb6d579976` passed CI run `45637573377`, including the same complete workflow. API integration tests now verify purchasing permission denial, permission grant and revocation, and cross-origin supplier mutation rejection.
- Neon recovery review: the isolated development branch is a child branch of production. A clone/branch rehearsal has been verified, but it is not a PITR restore. The available branch/snapshot tools do not expose the required self-history restore operation for a controlled rehearsal; the Neon API/Console restore workflow must be exercised by an authorized operator on the disposable development branch. Production remains untouched.
