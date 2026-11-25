# Product and recipe API security review

Date: 2026-11-25
Branch: `feature/pos-foundation`

## Reviewed routes

- `app/api/admin/products/route.ts`
- `app/api/admin/products/[id]/route.ts`
- `app/api/admin/categories/route.ts`
- `app/api/admin/recipes/route.ts`
- `lib/permissions.ts`

## Confirmed controls

- Product list/create and product update/archive resolve the current session, reload persisted permission overrides, and require `MANAGE_CATALOG`. Permission revocation therefore applies to subsequent requests.
- Product create/update/archive mutations check request-origin metadata and use the shared database-backed `catalog-write` rate-limit bucket.
- Product create/update/archive and their audit events execute in the same Prisma transaction. A failed audit insert rolls back the corresponding product mutation.
- Category create/update/archive follow the same `MANAGE_CATALOG`, origin, rate-limit and transactional-audit pattern.
- Recipe list/create/delete require `MANAGE_INVENTORY`, check mutation origin, and apply a dedicated `recipe-write` rate limit.
- Recipe upsert and recipe deletion write their audit event in the same transaction as the recipe mutation.
- Recipe quantity parsing rejects non-finite, non-positive and excessively large quantities. Product and ingredient identifiers are bounded strings; database foreign keys and the composite product/ingredient key constrain the relationship.
- Owner permission defaults remain enabled; manager defaults remain enabled; cashier defaults remain disabled. Owner permissions cannot be overridden off by the generic override object.

## Gaps to close before acceptance

1. The checked-in PostgreSQL HTTP integration test currently exercises product/category-related setup and category lifecycle, but the inspected test segment does not establish product API grant/revoke and denied-write side-effect assertions. Add explicit tests for product GET/POST/PATCH/DELETE with a cashier: default denial, grant, revoke, and unchanged product/audit counts on denial.
2. The inspected integration test does not establish recipe API grant/revoke or denied POST/DELETE side-effect assertions. Add those using a cashier with `MANAGE_INVENTORY` toggled, and assert recipe-item and audit counts remain unchanged on denial.
3. Add malformed recipe quantity and nonexistent product/ingredient relationship tests. Assert no recipe item or audit event is created on rejection.
4. Locate and review the product-variant and modifier-group mutation routes separately. The product detail route is protected, but nested variant/modifier handlers may have independent authorization and transaction boundaries; do not assume they inherit the parent route's guard.
5. Add audit-rollback tests for product/category/recipe writes by forcing an audit failure only in the isolated integration database. Existing code structure is transactional, but rollback behavior is not established by static inspection alone.

## Scope and safety

This is a focused source review, not a penetration test or completed authorization acceptance. No schema changes, production database operations, environment-variable changes, or deployments were performed. Multi-branch data isolation remains out of scope for this single-store POS phase and is a mandatory gate before multi-branch rollout.


## Follow-up implementation — 2026-11-25
- Fixed product options authorization: GET and PUT now enforce persisted `MANAGE_CATALOG` rather than a hard-coded OWNER/MANAGER role check.
- Product image upload now enforces the same persisted `MANAGE_CATALOG` permission. The previous role-only check could bypass an explicit catalog permission revocation.
- Catalog integration assertions now cover options and image-upload denial, options grant and revocation, successful variant/modifier persistence, invalid recipe ingredient rejection without destructive replacement, and audit counts.
- Inventory integration assertions now cover recipe read/write denial, permission grant and revocation, successful upsert, invalid quantities, missing product/ingredient references, and rejected-write side effects.
- Latest-head CI execution remains pending. Audit-failure rollback injection remains outstanding and must only run against the isolated CI/development database.
