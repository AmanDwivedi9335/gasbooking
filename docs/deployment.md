# Deployment

## Deployment topology

Use a managed MongoDB replica set with authentication, TLS and network access limited to application and worker hosts. Deploy one Next.js web service and a separate persistent worker. The Dockerfile can run both. Set the worker command to `npm run worker`. Both need `MONGODB_URI` and `CREDENTIAL_KEY`. Set the web service's `APP_ORIGIN` to its exact HTTPS origin. Use a managed secret store and disable development seeding in production.

Initialize database collections and indexes with `npm run db:init` before routing traffic. For a new agency, run `npm run agency:bootstrap` with the following secret environment variables, then remove them from the running service configuration.

| Variable | Purpose |
| --- | --- |
| BOOTSTRAP_AGENCY | Agency display name |
| BOOTSTRAP_BRANCH | Initial branch |
| BOOTSTRAP_OWNER_NAME | Administrator display name |
| BOOTSTRAP_OWNER_EMAIL | Unique sign-in address |
| BOOTSTRAP_OWNER_PASSWORD | Initial password, 14 characters minimum |
| BOOTSTRAP_TOTP_BASE64 | Base64-encoded authenticator secret, at least 20 random bytes. Register the same secret in the authenticator with a 30-second period, six digits and SHA-1. |
| BOOTSTRAP_EMERGENCY_PHONE | Optional authorized agency emergency number in international format |

## Release checks

Check `GET /api/v1/health` for a writable replica-set primary. Verify staff MFA, customer and driver isolation, booking transactions and outbox recovery on staging with synthetic data. Run a backup restore to a separate database before the first release and record the recovery time. Configure database backups, private audit storage, worker dead-letter alerts and HTTPS termination.

## Current operational limits

Live Winquly connectivity needs the approved provider contract and credentials. Incoming customer conversations are persisted for handoff. Conversational booking and external LPG provider booking are pending. Billing supports manual cash and verified UPI recording and invoice printing. Online gateways, refunds, tax-compliance certification and settlement exports are pending. Delivery proof records the recipient, returned quantities and optional customer portal code verification. Attachments and batch routing are pending.

Bulk imports, XLSX exports, account recovery, configurable custom roles, platform-wide SaaS administration, S3 attachments, and production backup and monitoring verification remain open. Validate the agency's tax, safety, privacy, and retention policies before deployment.
