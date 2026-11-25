# Public customer storefront

The customer-facing website is available at `/shop`. The staff point-of-sale workflow remains at `/`.

## Catalogue source

The public catalogue is served by `GET /api/storefront/products`. It is read-only and exposes only active, available products and active categories from one configured branch. It does not reuse the staff-authenticated `/api/products` endpoint.

Set `STOREFRONT_BRANCH_ID` to the branch ID intended for public display. If omitted, the route uses the seeded `main-branch`. The selected branch must be active.

## Current customer features

- Responsive customer landing page and product catalogue
- Category filtering and product search
- Product descriptions, images, and variant selection
- Local basket with quantity controls and subtotal
- No customer account or staff authentication required to browse

## Not yet connected

The basket is currently a client-side preview. Customer order submission, delivery/pickup scheduling, customer accounts, online payments, and order status tracking are not enabled. Payment providers remain intentionally deferred.

The storefront is deliberately separate from POS checkout until customer ordering rules and fulfilment flows are implemented.
