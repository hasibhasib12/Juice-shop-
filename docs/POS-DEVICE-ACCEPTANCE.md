# POS device and final acceptance checklist

This checklist is for the owner/operator to complete on the approved Preview build. It is deliberately not marked passed until the actual device/browser is tested. Never use production data for this rehearsal.

## Test environment
- [ ] Use the approved Preview URL and confirm the build commit shown in the deployment matches the accepted feature-branch commit.
- [ ] Use a disposable staff account and test catalogue.
- [ ] Confirm store defaults display Afghanistan / AFN / Asia-Kabul and tax remains zero unless the owner has configured a verified legal tax rule.
- [ ] Confirm the Preview database is the isolated development Neon branch, not production.

## Barcode scanner acceptance
Test each scanner model separately. Keyboard-wedge scanners should behave like keyboard input.
- [ ] Connect scanner and focus the POS search field.
- [ ] Scan a known SKU with the scanner's configured suffix (prefer Enter).
- [ ] Confirm exactly one matching product is added to the order.
- [ ] Scan the same SKU twice and confirm quantity increments twice, with no duplicate or dropped scan.
- [ ] Scan an unknown SKU and confirm a clear no-match message without changing the order.
- [ ] Scan while another input/control is focused and confirm the UI does not add an unintended product.
- [ ] Test fast consecutive scans, leading zeros, long SKUs, and a SKU containing supported punctuation.
- [ ] Verify the operator can recover focus using keyboard navigation.

Record scanner make/model, interface (USB/Bluetooth), OS, browser, configured suffix, and results.

## Receipt printer acceptance
The application uses browser printing and an 80 mm receipt stylesheet; it does not currently provide direct ESC/POS printer control.
- [ ] Install the printer using the manufacturer's supported OS driver.
- [ ] Select the printer in the browser print dialog.
- [ ] Set paper width to 80 mm, margins to the printer-compatible minimum, scale to 100%, and disable browser headers/footers.
- [ ] Print a receipt with long product names, variants/modifiers, multiple tenders, discounts, tax (if configured), and refund history.
- [ ] Confirm text is legible, totals align, no content is clipped, and the receipt does not unexpectedly print across multiple pages.
- [ ] Test paper feed/cut behavior using the printer's driver settings.
- [ ] Confirm reprint produces the same order number and totals.
- [ ] Repeat on every intended printer model and workstation/browser combination.

Record printer make/model, driver version, OS, browser, paper width, print settings, and results. Cash drawer kick and direct printer commands are not supported acceptance criteria in this release.

## Responsive layout and accessibility acceptance
Run each screen size in browser devtools and on at least one real phone and tablet.
- [ ] 360 × 800 phone portrait
- [ ] 390 × 844 phone portrait
- [ ] 768 × 1024 tablet portrait
- [ ] 1024 × 768 tablet/compact desktop
- [ ] 1366 × 768 desktop
- [ ] 1920 × 1080 desktop

For each size:
- [ ] Product search, categories, product cards, order panel, tender and checkout remain reachable without horizontal page scrolling.
- [ ] The order list scrolls independently and checkout total/action remain visible and usable.
- [ ] Modals and forms fit the viewport and their controls remain reachable when the on-screen keyboard opens.
- [ ] Loading, empty, offline, validation-error, API-error and success states are understandable.
- [ ] Keyboard-only test: Tab/Shift+Tab order, Enter/Space activation, Escape dismissal where applicable, and visible focus indicator.
- [ ] Screen-reader smoke test for login, product search, cart line quantity/removal, payment inputs, errors, and checkout confirmation.
- [ ] Confirm reduced-motion preference is respected.
- [ ] Confirm text zoom to 200% does not hide critical actions.

Record browser/version, OS/device, viewport, assistive technology, issues, and screenshots.

## POS operational acceptance
- [ ] Complete cash sale; verify cash received and change.
- [ ] Complete split cash/manual OTHER sale and confirm tender totals equal order total.
- [ ] Retry the same checkout idempotency key and verify no duplicate sale.
- [ ] Attempt checkout with insufficient stock and verify no partial stock deduction.
- [ ] Save and convert a draft; verify the final sale and stock movements.
- [ ] Perform partial and full refunds with appropriate permissions and verify audit trail and shift cash reconciliation.
- [ ] Record item returns with valid condition/disposition and verify over-return is blocked.
- [ ] Open shift, record paid-in/out, close shift and reconcile expected cash.
- [ ] Confirm cashier cannot access manager-only operations; verify configured permission overrides.
- [ ] Verify product image upload and that the uploaded image renders on the POS product card.
- [ ] Test two cashiers attempting the same last-stock item concurrently.
- [ ] Test network interruption during checkout and verify the operator receives a safe recoverable result without duplicate charging/order creation.

## Sign-off record
Record Preview URL, accepted commit SHA, test date/time/timezone, tester, device/browser matrix, defects, and owner approval. A failed or untested item remains open; do not infer device compatibility from a successful build or unit test.
