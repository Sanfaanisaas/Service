# SANFAANI Operations

SANFAANI v1 is an internal Admin and Staff operations console for charging, workspace visits, customer records, inventory, sales, receipts, reporting, and access administration.

## Product variants

- GitLab preserves the full pre-production product, including the recoverable customer portal.
- GitHub is the production source for the Admin/Staff-only console.
- Customer records, ownership rules, models, and customer APIs remain in the production backend. Public signup and customer-facing routes are intentionally absent from the production frontend.

The exact repository split and rollback reference are documented in [docs/PRODUCT-VARIANTS.md](docs/PRODUCT-VARIANTS.md).

## Architecture

- `frontend/sanfaani-operations`: Vite/React PWA deployed as static assets.
- `backend/api-server`: Express API using Supabase Auth and MongoDB transactions.
- `lib/api-spec`: canonical OpenAPI contract.
- `lib/api-client-react` and `lib/api-zod`: generated typed clients and validators.

## Local verification

Use Node 22 and the pinned pnpm version:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Copy the frontend and backend `env.production.example` files to untracked local `.env` files and replace placeholders. The frontend also includes `env.e2e.example` for the gitignored staging browser-test environment. See [docs/PRODUCTION.md](docs/PRODUCTION.md) for deployment, security, health checks, staging tests, and rollback.

### Clearing stale local PWA state

The service worker is registered only in production builds; Vite development does not register it. If a developer previously registered a local service worker, open Chromium DevTools, go to **Application → Service Workers**, choose **Unregister**, then go to **Application → Storage**, choose **Clear site data**, and hard-refresh the page. This is a one-time local debugging step, not a production-user action.

## Supported application roles

- Admin: all operational modules, analytics, settings, Staff Management, and controlled role management.
- Staff: daily operational modules; no settings, staff administration, role mutation, or admin analytics.
- Customer: retained backend identity type only; denied access to the production operations console.
