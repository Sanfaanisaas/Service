# SANFAANI product variants

## GitLab full version

Repository: `git@gitlab.com:adeoyeopeyemi951/Website-Builder.git`

The full version contains Admin, Staff, the customer portal and public signup, customer-facing routes, customer ownership behavior, and the existing RC/P2 implementation.

- Archive branch: `archive/full-product-pre-production`
- Immutable annotated tag: `full-product-pre-production-2026-08-15`
- Preserved commit: `5a9a758cee467556721c9a2a4a75665c7f453bdc`
- Tag annotation: “Full SANFAANI version before production customer-portal removal. Contains Admin, Staff, Customer portal and existing RC/P2 implementation.”

The archive references were pushed without changing GitLab `main` or rewriting history.

## GitHub production version

Repository: `git@github.com:Sanfaanisaas/Service.git`

The production line contains the Admin and Staff operational UI, operational customer management, and all customer backend APIs/models/ownership controls. It deliberately has no public signup or customer portal navigation/routes. A Supabase identity whose authoritative AppUser role is `customer` receives a generic restricted-access page and cannot enter the console.

Production branch: `production/admin-staff-v1`.

## Rollback

To recover the full customer-portal product, create a new branch from the immutable GitLab tag. Do not move the tag, rewrite either repository, or merge the archived frontend directly into production without a new reviewed product decision.

```bash
git fetch git@gitlab.com:adeoyeopeyemi951/Website-Builder.git full-product-pre-production-2026-08-15
git switch -c recovery/full-product FETCH_HEAD
```
