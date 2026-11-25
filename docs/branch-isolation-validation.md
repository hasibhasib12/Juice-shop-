# Branch isolation validation notes

The product catalogue API requires an authenticated session. Integration coverage asserts unauthenticated requests receive HTTP 401 and authenticated requests receive only the signed-in user's branch catalogue.

Recipe writes reject ingredient IDs that do not belong to the product manager's branch. A missing or foreign-branch ingredient is intentionally reported as not found (HTTP 404), avoiding cross-branch resource disclosure.

The latest CI run before these expectation updates passed Prisma validation, migrations, and lint. Its test step had 41 passing tests and two expectation failures. TypeScript and the production build were skipped after the test step failed. A fresh full validation is required before release.
