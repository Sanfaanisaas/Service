# SANFAANI RC-01 staging runbook

RC-01 destructive verification must run only against a dedicated staging frontend, API, MongoDB database, and Supabase project. The current local environment is not proof of staging separation.

## Required application variables

Frontend build variables:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=
VITE_VAPID_PUBLIC_KEY=
```

Backend runtime variables (the names below are the names parsed by the application):

```env
NODE_ENV=production
SERVER_PORT=5000
MONGODB_URI=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CLIENT_URL=
SANFAANI_ADMIN_EMAIL=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.test
```

Never expose `MONGODB_URI`, `SUPABASE_SERVICE_ROLE_KEY`, or `VAPID_PRIVATE_KEY` through a `VITE_` variable. `CLIENT_URL` must be the exact HTTPS staging frontend origin; the API does not use a wildcard CORS policy.

## Required GitLab protected and masked variables

Set the application variables in the staging deployment provider. Set these separately in GitLab for the staging E2E job:

```env
E2E_BASE_URL=
E2E_API_URL=
E2E_SUPABASE_URL=
E2E_SUPABASE_ANON_KEY=
E2E_ADMIN_EMAIL=
E2E_ADMIN_PASSWORD=
E2E_STAFF_EMAIL=
E2E_STAFF_PASSWORD=
E2E_CUSTOMER_A_EMAIL=
E2E_CUSTOMER_A_PASSWORD=
E2E_CUSTOMER_A_PHONE=
E2E_CUSTOMER_B_EMAIL=
E2E_CUSTOMER_B_PASSWORD=
E2E_CUSTOMER_B_PHONE=
```

For local execution, create `frontend/sanfaani-operations/.env.e2e` from the variable block above. The file is gitignored; fill it with staging-only values.

Use synthetic identities. The MongoDB URI must name a staging-only database, and the Supabase URL must identify a staging-only project. Restrict the E2E variables to protected release branches and the `staging` environment.

## Deployment acceptance

1. Deploy the backend with the staging runtime variables and confirm `GET /api/health` returns only `{ "success": true, "data": { "status": "ok" } }`.
2. Deploy the frontend with the staging public variables. Confirm HTTPS, manifest, service worker, and CSP response headers.
3. Confirm the frontend origin receives `Access-Control-Allow-Origin`; send the same request from an unrelated origin and confirm it does not receive that origin in the header.
4. Confirm MongoDB ping, replica-set sessions, a committed transaction, and an intentionally rolled-back transaction against staging data.
5. Provision Admin, Staff, Customer A, and Customer B in the staging Supabase project. Let `/api/me` create their application records, then use an admin to assign only the Staff role.
6. Run `pnpm test:e2e`. Tests prefix records with `RC01-`, restore mutable settings/profile values, release capacity locks, and deactivate created products where practical.

## Physical checks not replaceable by headless E2E

- Install from the deployed HTTPS origin and launch standalone.
- Receive a real charging-ready push, open it, unsubscribe, and verify dead-subscription cleanup.
- Scan a receipt QR with a physical mobile camera and confirm collection before release.
- Inspect receipt print preview and the downloaded PDF.
- Qualify Chromium desktop and Android at 375, 430, 768, 1024, and large-desktop widths.
- Exercise password-reset email delivery and both valid and expired links.

Record the deployment URLs, provider project identifiers (not secrets), timestamp, tester, browser versions, and evidence in the release ticket.
