# Nexa Store — Render deployment

Arabic RTL storefront with the Sham Cash API v1 backend. See `render.yaml` for the Render Blueprint. The complete compressed source is stored in ordered parts `nexa-store-source.part00` onward; Render joins and extracts them during the build.

## Deploy
1. Open https://dashboard.render.com/blueprint/new?repo=https://github.com/bro676/Store
2. Review the service and PostgreSQL plan and charges in Render before applying. The Blueprint uses paid Starter web compute and a small paid PostgreSQL plan.
3. Supply `SHAM_API_TOKEN` and `SHAM_WALLET_ID` as secrets. Never commit credentials.
4. Keep `PAYMENTS_ENABLED=false` until the provider key has `read:wallets`, `read:transactions`, `write:invoices`, and `read:invoices`, the active Sham Cash wallet ID is verified, and every product price in `server/catalog.json` has been reviewed and approved.
5. After configuration, change `PAYMENTS_ENABLED` to `true` in Render, save, and deploy. Then verify `/api/health` and `/api/payments/config` and perform a low-value live test.

## Bundle contents
The archive contains the complete Nexa Store source under `nexa-store-premium-web/`: Arabic RTL storefront, responsive UI, local SVG assets, Node.js API, PostgreSQL migrations, Sham Cash integration documentation, and environment template. It excludes previews and standalone demo HTML to keep the deployment source small. No API token, wallet PIN, or database credential is included.

## Important
The project deliberately starts with payments disabled. Product prices in the catalog are sample/demo values until approved. Review the current Render pricing in the Blueprint confirmation screen before creating resources. Product delivery automation requires a separate supplier API integration.