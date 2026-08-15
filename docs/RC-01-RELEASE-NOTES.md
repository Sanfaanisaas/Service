# SANFAANI RC-01 release notes

## Release gates added

- Production Playwright verification for real Admin/Staff Supabase authentication, browser sessions, RBAC, customer-role denial, inactive users, charging claims, receipts/PDF, inventory and oversell, workspace occupancy, settings propagation, PWA offline behaviour, and responsive internal layouts.
- GitHub Actions gates for frozen install, tracked-secret scan, typecheck, unit/integration tests, production build, and optional protected staging E2E. Existing GitLab CI remains with the preserved full repository.
- Admin-only Supabase staff invitation with a fixed initial Staff role, transactional AppUser/audit persistence, and rollback of a newly invited identity if application persistence fails.
- Public signup and customer-facing production routes removed while customer backend contracts and ownership regression coverage remain intact.
- Frontend CSP, HSTS, permissions policy, and regression coverage for the static deployment headers.
- A tracked-secret scanner that reports only filename, line, and finding type.

## Known limitations

- Real staging/production deployment, password-reset email delivery, push delivery, physical camera scanning, installation, and device/browser qualification require external staging access and physical/browser evidence.
- Claim tokens remain plaintext at rest to support authorized receipt regeneration; the accepted risk and migration options are documented in `RC-01-SECURITY.md`.
- Historical occupancy/utilization snapshots, customer email changes, optional bundle splitting, and Firefox/Safari/iOS qualification remain deferred.
