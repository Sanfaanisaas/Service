# SANFAANI RC-01 release notes

## Release gates added

- Staging-only Playwright verification for real Supabase authentication, browser sessions, RBAC, inactive users, charging claims, receipts/PDF, inventory and oversell, workspace occupancy, settings propagation, profiles, ownership, PWA offline behaviour, and responsive layouts.
- GitLab pipeline gates for frozen install, tracked-secret scan, typecheck, unit/integration tests, production build, and mandatory staging E2E on release-relevant refs.
- Frontend CSP, HSTS, permissions policy, and regression coverage for the static deployment headers.
- A tracked-secret scanner that reports only filename, line, and finding type.

## Known limitations

- Real staging deployment, destructive MongoDB transaction tests, test-identity provisioning, password-reset email delivery, push delivery, physical camera scanning, installation, and device/browser qualification require external staging access and physical/browser evidence.
- Claim tokens remain plaintext at rest to support authorized receipt regeneration; the accepted risk and migration options are documented in `RC-01-SECURITY.md`.
- Historical occupancy/utilization snapshots, customer email changes, optional bundle splitting, and Firefox/Safari/iOS qualification remain deferred.
