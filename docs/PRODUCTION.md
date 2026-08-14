# SANFAANI production runbook

## Deployment shape

Deploy `frontend/sanfaani-operations` as the Vite static application and `backend/api-server` as a persistent Node service. Set `VITE_API_URL` to the backend origin without a trailing `/api`; the generated client adds `/api` itself. The frontend host must rewrite non-file routes to `index.html` for authenticated deep links.

Production must use HTTPS. Service workers, browser push, and camera scanning require a secure context outside localhost. The backend should be reachable only over HTTPS from the browser.

## Required environment

Frontend:

- `VITE_SUPABASE_URL`: Supabase project URL.
- `VITE_SUPABASE_ANON_KEY`: public/anonymous browser key, never a service-role key.
- `VITE_API_URL`: deployed API origin, for example `https://api.example.com`.
- `BASE_PATH`: optional Vite base path; `/` is the normal deployment.

The VAPID public key is fetched from authenticated `GET /api/push/public-key`; it is not duplicated in the Vite bundle.

Backend:

- `NODE_ENV=production`
- `SERVER_PORT`
- `MONGODB_URI`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLIENT_URL`: the one explicitly allowed production frontend origin; never use `origin: true`.
- `SANFAANI_ADMIN_EMAIL`: bootstrap administrator email.
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`: server only.
- `VAPID_SUBJECT`: a `mailto:` or HTTPS contact URI.

Store backend values in the deployment provider's secret manager. The ignored local `.env` files are development inputs and must never be copied into a frontend artifact or committed.

## Release checks

1. Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
2. Verify `GET /api/health` returns only `{ success: true, data: { status: "ok" } }`.
3. Confirm the deployed frontend origin exactly equals `CLIENT_URL` and an unrelated Origin is rejected by CORS.
4. Exercise admin, staff, and customer logins in Chromium; refresh each authenticated route.
5. Complete charging, inventory sale, workspace, customer ownership, and RBAC smoke workflows.
6. Install the PWA in desktop and mobile Chromium; verify the offline banner and that a mutation cannot be submitted offline.
7. With real VAPID keys, enable notifications by user action, mark a device READY, verify the privacy-safe push, and open `/customer/device` from the notification.
8. Test the critical workflows at 375, 430, 768, and at least 1024 CSS pixels.

Safari/iOS support must not be claimed until separately tested. Browser push cannot be considered deployment-verified without valid VAPID configuration and a real browser subscription.
