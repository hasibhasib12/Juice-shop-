# Juice Shop — Product & Development Roadmap

## Product vision
Build an integrated, multi-location juice-bar and restaurant operations platform. The POS remains the commercial and operational foundation. All modules share a central order, catalogue, inventory, staff, payment, audit and reporting model.

Initial operating defaults remain Afghanistan / AFN / Asia-Kabul / en-AF, while the platform must support configurable countries, currencies, time zones, languages and tax rules. Never assume a tax rate or legal treatment. Card gateway integration remains deferred until explicitly selected.

## Release and safety rules
- All development stays on `feature/pos-foundation`; never modify `main` during development.
- Production Neon branch remains untouched. Schema migrations and test data are restricted to isolated development branches.
- No deployment during development. Preview releases require explicit owner approval, CI verification and deployment-quota review.
- Do not claim physical-device or end-to-end acceptance without actually testing it.
- Build role-aware modules with server-side authorization, audit trails, rate limits, validation, idempotency where appropriate, and tenant/branch boundaries designed in from the start.

## Phase 0 — Complete and accept the POS (current priority)
- Finish the compact order panel and consolidated order actions.
- Complete security/session/CSRF and API authorization audit.
- Add integration and concurrency coverage for checkout, inventory, refunds, purchasing, drafts, table assignment and shift reconciliation.
- Complete responsive and accessibility review.
- Rehearse backup/restore on a disposable development branch.
- Verify product image upload/rendering on an approved Preview.
- Test supported barcode scanner and receipt printer hardware.
- Run full cashier/manager/owner acceptance, including failure recovery and multi-cashier workflows.
- Obtain owner acceptance before any production release.

## Phase 1 — Kitchen Display System (KDS)
- Live kitchen queue with new, accepted, preparing, ready and served/cancelled states.
- Configurable preparation stations (e.g. juices, smoothies, desserts) and routing rules per product/category.
- Ticket grouping, modifiers, special instructions, elapsed-time indicators, overdue alerts and sound notifications.
- Bump/recall tickets, station filtering, kitchen history and performance reporting.
- Safe event delivery/reconnect behavior so refreshes or network interruptions do not lose tickets.
- Kitchen-only role permissions and auditable status transitions.

## Phase 2 — Waiter operations
- Staff waiter role and dedicated tablet/mobile workflow.
- Visual floor plan, table assignment, open checks, add-on orders and course/fire controls.
- Transfer/merge tables, split bills, service requests, bill requests and table clearing.
- Send additions/changes to the correct kitchen stations without duplicating prior items.
- Server-side permissions, shift attribution and activity history.

## Phase 3 — QR self-service table ordering
- Unique, revocable QR token per table; do not expose sequential internal table IDs as authorization.
- Customer web menu without app installation, with product availability, variants, modifiers and clear pricing.
- Guest cart and order submission with abuse protection, idempotency and configurable manager/staff approval.
- Customer requests: call waiter, request bill and ask for assistance.
- Staff review/acceptance controls, table-scoped access, privacy protections and configurable ordering hours.
- Optional payment integration only after a provider is selected; cash/manual payment remains available.

## Phase 4 — Table and floor management
- Configurable floor plans, areas, table capacities and table status.
- Reservations/waitlist only if the business chooses to enable them.
- Occupancy duration, table turnover, service-time and sales analytics.
- Safe table merge/transfer and conflict handling for concurrent staff actions.

## Phase 5 — Delivery management
- Delivery order intake and dispatch queue, separate from in-store/table orders.
- Driver accounts and least-privilege mobile interface.
- Assignment, acceptance, pickup, en-route, delivered and failed-attempt states.
- Delivery address/contact handling, proof of delivery and customer notifications.
- Delivery zones/fees and cash-on-delivery reconciliation configurable by jurisdiction.
- Optional map/geocoding provider only after provider and privacy requirements are chosen.

## Phase 6 — Customer experience and loyalty
- Customer profiles, consent-aware purchase history and contact preferences.
- Loyalty points, rewards, membership tiers, coupons and promotions.
- Customer order status and receipts.
- Data minimization, retention controls and opt-out support.

## Phase 7 — Finance and business management
- Expense capture, cash flow, profit/loss and configurable accounting categories.
- Supplier statements and outstanding balances.
- Cost/margin analytics, branch-level financial summaries and exportable reports.
- Reconciliation and audit-ready records; accounting/tax rules configured with the business's accountant.

## Phase 8 — Advanced inventory and procurement
- Reorder suggestions, low-stock alerts and demand forecasting.
- Batch/lot and expiry tracking where relevant.
- Waste analysis, recipe cost and margin monitoring.
- Supplier scorecards, purchase planning and inter-branch transfers.

## Phase 9 — Workforce management
- Attendance, schedules, time tracking and leave.
- Payroll calculations and commissions as configurable records, not legal payroll advice.
- Role/permission templates, training checklists and staff performance reporting.

## Phase 10 — Multi-branch operations
- Branch-aware data model, settings, stock, staff, tills and reporting.
- Central administration with branch-level access controls.
- Inter-branch transfers and consolidated reporting.
- Currency/time-zone boundaries and configurable local tax settings.
- Tenant isolation and branch-scoped audit/security tests.

## Phase 11 — Online ordering (optional)
- Public web ordering, pickup scheduling and order management.
- Delivery integration where enabled.
- Shared catalogue and inventory with POS; no separate disconnected product database.
- Payment provider integration only after owner selection and compliance review.

## Phase 12 — AI business intelligence (optional)
- Forecasting for sales, staffing and purchasing with explainable inputs.
- Margin and waste insights, anomaly alerts and suggested actions.
- Human approval for consequential actions; AI never silently changes prices, stock or financial records.

## Architecture principles
- One canonical order lifecycle with explicit order source and fulfillment type.
- Separate kitchen ticket lifecycle from payment/order lifecycle.
- Append-only/auditable transitions for sensitive workflows.
- Real-time updates with durable database state and reconnect/replay support.
- Idempotent writes and concurrency-safe table, stock, ticket and payment operations.
- Branch-aware permissions and data boundaries from the outset.
- Progressive enhancement for unreliable networks; clearly show stale/offline state.
- No customer ordering, delivery or external payment is exposed until its security and acceptance gates pass.

## Status
This is the approved product roadmap. Only Phase 0 is currently in active completion. Later phases are planned scope, not implemented features. Each phase requires its own design, implementation, tests, migration review and owner acceptance.
