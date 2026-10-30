# Nexa Store

Arabic RTL digital storefront with a Node.js API and PostgreSQL-backed Sham Cash invoice verification.

## Live deployment

- Store: https://nexa-store-9st4.onrender.com
- GitHub: https://github.com/bro676/Store
- Render service: nexa-store (Frankfurt, Free)
- Health: /api/health
- Payment configuration: /api/payments/config

## Checkout currencies

Checkout supports SYP and USD. Product prices remain the existing SYP catalog amounts. USD is calculated on the server from SYP_PER_USD, and the selected currency and exact amount are sent to the Sham Cash invoice and stored in PostgreSQL. The browser cannot override the price. Sham Cash verification checks the incoming credit, receiving wallet, exact amount/currency, transaction time, invoice status, and one-time transaction use.

The configured reference conversion rate is 14,287.5 catalog SYP units per USD, based on the market midpoint published by SYPNow on 2026-10-30. The SYP market uses a redenominated/new unit and legacy/old unit; this store's existing catalog prices are in the legacy numeric scale. Confirm that your Sham Cash account and its transaction records use the same unit before accepting customer payments. Refresh SYP_PER_USD and its timestamp/source when the market rate changes.

## Secrets

Set SHAM_API_TOKEN and SHAM_WALLET_ID only in Render environment secrets. Never commit API tokens, wallet PINs, or database credentials.

## Fulfillment and pricing

The catalog retains the previously entered demo prices; they are not independently verified supplier prices. Confirm every product price and fulfillment method before public sales. Payment verification is implemented, but automatic delivery/top-up requires a separate supplier API integration. Until that exists, orders must be fulfilled manually after payment is verified.

## Render

The Blueprint uses a Free Node web service and Free PostgreSQL. Render's free database has an expiry/retention limit; monitor its expiry and back up or migrate before the deadline.
