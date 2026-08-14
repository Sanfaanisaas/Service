# RC-01 security decisions

## Claim token at rest

Charging claims use a random 256-bit token, hide it from normal model selections, require staff authorization for verification, and become unusable after collection. The token is currently stored in plaintext so an authorized receipt can be reopened and its QR/PDF regenerated.

Hash-only storage is not a safe drop-in RC change: after the initial response, a one-way hash cannot reproduce the raw credential for an existing authorized receipt. Changing this without a receipt-delivery migration would silently remove QR/PDF claims from reopened receipts.

Classification: **POST-RC SECURITY HARDENING**. The follow-up design must choose one of:

- issue the raw credential once and make the initial PDF the durable customer instrument; or
- encrypt the token at rest with a separately managed rotation key while storing an HMAC lookup index.

Until then, restrict database access, rotate provider credentials, avoid logging receipt-detail bodies, retain one-time collection semantics, and treat database backups as sensitive bearer-credential material.

## Content Security Policy

The deployed frontend now denies framing, plugins, non-self scripts, and `unsafe-eval`. Inline styles remain allowed because the current React/chart styling stack emits inline style attributes. `connect-src` permits HTTPS/WSS because Vercel's static header file cannot interpolate staging and production API/Supabase origins. Narrowing it to exact origins is a post-deployment-provider improvement, not a reason to remove CSP.

## Secure contexts

Service workers, push, installability, and camera scanning require HTTPS in deployed environments. Localhost is acceptable only for development. The E2E configuration rejects a non-HTTPS base URL unless `E2E_ALLOW_INSECURE=1` is explicitly set for a local run.
