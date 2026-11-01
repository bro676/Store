# Nexa Store

Nexa Store is an Arabic RTL digital storefront with a Node.js API, PostgreSQL persistence, Sham Cash payment verification, supplier catalogues, and automated supplier fulfilment.

## Live project

- Storefront: https://nexa-store-9st4.onrender.com
- Admin: https://nexa-store-9st4.onrender.com/admin.html
- API health: https://nexa-store-9st4.onrender.com/api/health
- Repository: https://github.com/bro676/Store
- Render service: nexa-store in the Store workspace, Frankfurt

## Architecture

- Customer storefront and admin dashboard: nexa-store-premium-web/index.html and admin.html.
- Backend: Node.js HTTP API under nexa-store-premium-web/server/src.
- Database: PostgreSQL; live catalogue and store settings are stored in nexa_store_state.
- Database schema changes are applied idempotently from server/migrations at startup.
- Store and admin theme preferences are independent. The visual system uses Nexa charcoal/gold with distinct light and dark modes.

## Product catalogue and navigation

The customer journey is: main department → supplier category → product → option/region → pack.

The live catalogue is stored in PostgreSQL and can be synchronised from supplier or external catalogue APIs. Product names, source IDs, images, options, availability and prices are managed separately from the local artwork folder structure. The helper assets/brand/nexa-catalog.js resolves product records by stable IDs and maps the catalogue to the department hierarchy.

## Payments and customer wallet

Sham Cash invoices and payment verification are server-side. The server checks the actual incoming credit, receiving wallet, amount, currency, timestamp, invoice status and one-time transaction reference before marking an order paid. Browser-submitted prices are never trusted.

Checkout supports SYP and USD. The store's database configuration was set to manual FX at 145 new SYP per USD on 2026-11-01; this value is controlled in Admin → Settings and must be reviewed against the approved rate before real sales. Customers can also use the internal wallet in SYP. Wallet top-ups are credited only after successful Sham Cash verification; wallet purchases use an atomic database transaction and ledger entry.

## Supplier integrations

- WAMDA: API-token integration, catalogue synchronisation, availability checks, layered retail pricing, order reconciliation, and fulfilment after verified payment. The observed automatic catalogue refresh interval was 15 minutes; the observed global markup was 15% at the time of the 2026-11-01 audit.
- SEAGM: signed API client, product catalogue import, card/direct-recharge order creation, signed callback verification, order reconciliation, encrypted delivery data, and bounded retries. The merchant UID and Secret Key must be configured by the owner in Admin → SEAGM Supplier. Start in Sandbox and complete a merchant-authorised end-to-end test before enabling Production.
- Supplier jobs are queued only after verified payment. A callback is a wake-up signal, not proof of payment or delivery.

## Operational requirements

- Keep API tokens, passwords, and database credentials out of GitHub and browser code. Secrets entered in the admin dashboard are encrypted at rest.
- GET /api/health reports database, payment configuration, and recently verified wallet state separately; a configured wallet is not the same as a recently verified wallet.
- Expired, unpaid invoices are transitioned to expired by a periodic server sweep. They are not deleted.
- The Render PostgreSQL instance observed during the 2026-11-01 audit is on the Free plan and is scheduled to expire on 2026-11-29 14:40 UTC. Back up and migrate or upgrade the database before that deadline. Do not rely on the service remaining available after expiry.
- Restrict database network access to required trusted sources after confirming the service's private-network connection. The database was observed with a public allow rule during the audit.

## Tests

Run from the repository root:

    npm --prefix nexa-store-premium-web/server install
    npm --prefix nexa-store-premium-web/server test

CI runs the backend and frontend regression tests on pull requests and commits to main.
