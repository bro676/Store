# Nexa Store

Arabic RTL storefront with the Sham Cash API v1 backend. The source archive is stored as 11 ordered text parts (`nexa-store-source.part00` through `part10`) and is reconstructed automatically by the Render build.

## Unpack locally
```bash
cat nexa-store-source.part* | base64 -d > nexa-store-source.tar.xz
tar -xJf nexa-store-source.tar.xz
```

## Deploy to Render
Open https://dashboard.render.com/blueprint/new?repo=https://github.com/bro676/Store. Review the paid Starter web service and `basic-256mb` PostgreSQL plan and charges before applying the Blueprint. The service and database are configured for Frankfurt and same-region private networking.

Set `SHAM_API_TOKEN` and `SHAM_WALLET_ID` as Render secrets. The API key needs `read:wallets`, `read:transactions`, `write:invoices`, and `read:invoices`. Never commit credentials or wallet PINs.

Keep `PAYMENTS_ENABLED=false` during the initial deploy. Review all sample prices in `nexa-store-premium-web/server/catalog.json` after extracting the archive. Enable payments only after verifying the active receiving wallet, key permissions, database migrations, and a low-value live transaction.

The archive includes the RTL storefront, local SVG assets, Node.js API, PostgreSQL migrations, Sham Cash integration docs, and `.env.example`. Preview images and the standalone demo HTML are excluded. Product prices remain sample values until approved. Automatic product delivery after payment requires a separate supplier API.