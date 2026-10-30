# Nexa Store — Render deployment

Arabic RTL storefront with the Sham Cash API v1 backend. See `render.yaml` for the Render Blueprint. The compressed source bundle is `nexa-store-source.tar.gz.b64`; Render extracts it during build.

## Deploy
1. Open https://dashboard.render.com/blueprint/new?repo=https://github.com/bro676/Store
2. Review the service and PostgreSQL plan and charges in Render before applying.
3. Supply `SHAM_API_TOKEN` and `SHAM_WALLET_ID` as secrets. Never commit credentials.
4. Keep `PAYMENTS_ENABLED=false` until the Sham Cash key, wallet, product prices, and a real low-value transaction have been verified.

The bundle contains the full storefront, local SVG assets, Node.js API, SQL migrations, and setup documentation. No API token, PIN, or database credentials are committed.