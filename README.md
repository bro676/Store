# Nexa Store

Arabic RTL digital storefront with a Node.js API and PostgreSQL-backed order/payment verification.

The source archive is stored as 11 ordered text parts (`nexa-store-source.part00` through `part10`). Render reconstructs it during each build. The GitHub Actions workflow also expands the source tree for maintenance.

## Render

- Service: `nexa-store` (Node.js, Frankfurt)
- Health check: `/api/health`
- Database: Render PostgreSQL (free trial; check expiry in Dashboard)
- Sham Cash secrets: `SHAM_API_TOKEN` and `SHAM_WALLET_ID` must stay in Render Secrets only.

## Payments

Payments must remain disabled until the server confirms the API token, receiving wallet, database, and invoice verification path are ready. Product prices in the catalog are sample values and must be approved before real sales. Never commit API tokens, wallet PINs, or database credentials.

## Currencies

The storefront can present SYP and USD only when exchange-rate conversion is server-authoritative and the selected currency is supported by the receiving payment provider. Sham Cash verification must use the exact currency and amount actually received; displaying USD alone does not make Sham Cash settle USD.

Automatic product delivery after payment requires a separate supplier API integration.
