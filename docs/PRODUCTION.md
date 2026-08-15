# SANFAANI production runbook

## Deployment shape and product boundary

GitHub is the production source for the internal Admin/Staff console. Deploy `frontend/sanfaani-operations` as a Vite static application and `backend/api-server` as a persistent Node service. Public signup and customer-facing frontend routes are intentionally unavailable. Customer records and dormant authenticated customer APIs remain supported by the backend.

Set `VITE_API_URL` to the backend origin without a trailing `/api`; the generated client adds `/api`. The frontend host must rewrite non-file routes to `index.html`. Production must use HTTPS for service workers, push, and camera scanning.

## Required environment

Frontend public values only:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL`
- `BASE_PATH` (optional; normally `/`)

Backend secrets/runtime values (the names parsed by the repository):

- `NODE_ENV=production`
- `SERVER_PORT`
- `MONGODB_URI`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLIENT_URL`: the exact allowed HTTPS frontend origin
- `SANFAANI_ADMIN_EMAIL`: initial administrator bootstrap identity
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

The backend fetches/serves the VAPID public key to authenticated clients. Store server values in the provider secret manager. Never copy MongoDB, service-role, VAPID private, or credential values into `VITE_*`, workflow YAML, source, or frontend artifacts.

## Provisioning and roles

Bootstrap the first admin with `SANFAANI_ADMIN_EMAIL`. Additional operational users are created by an Admin through Staff Management. `POST /api/staff/invite` uses the Supabase Admin API server-side, creates an active Staff AppUser, and audits the invitation. Subsequent promotion is an authenticated admin-only role mutation. There is no public Staff, Admin, or Customer signup.

## Deploy

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Deploy the backend first, then set `VITE_API_URL` and deploy `frontend/` with its `vercel.json`. Confirm `GET /api/health` returns only `{ "success": true, "data": { "status": "ok" } }`.

## Security acceptance

1. Confirm the frontend origin exactly equals backend `CLIENT_URL`; an unrelated `Origin` must not receive an allow-origin response.
2. Confirm Vercel returns CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, frame denial, and the reviewed permissions policy. CSP must not contain `unsafe-eval`.
3. Run `pnpm security:secrets` and inspect the final Git diff without printing secret values.
4. Verify Admin and Staff RBAC against frontend routes and direct APIs; verify customer-role, inactive, and unauthenticated identities are denied the operations console.
5. Verify MongoDB commit and forced rollback on a deployment that supports transactions. Charging, sales, and workspace must not leave partial domain, lock, ledger, movement, receipt, or audit records.

## Operational acceptance

Complete charging/claim/collection, inventory/restock/sale/oversell, workspace/check-in/checkout/capacity, receipt print/PDF/QR, analytics/CSV, settings propagation, password recovery, and responsive checks at 375, 430, 768, 1024, and desktop widths. Mutations must fail clearly offline.

Physical camera scanning, recovery-email delivery, real push delivery, standalone installation, and Vercel deployment require external/physical evidence and must be reported as not verified when unavailable.

## Push and PWA

PWA support remains useful for operational staff. Notification enrollment UI for customers is intentionally absent; backend push capability remains preserved/dormant. Notification bodies must stay privacy-safe. Push clicks are constrained to operational frontend paths, and mutations are never queued as apparent offline successes.

## Rollback

Rollback the production deployment to the prior known-good GitHub commit. To restore the full customer-portal product for development, branch from GitLab tag `full-product-pre-production-2026-08-15` (commit `5a9a758cee467556721c9a2a4a75665c7f453bdc`) as described in `docs/PRODUCT-VARIANTS.md`; never move the archive tag or force-push either repository.
