# Sham Cash API v1 — implementation notes

This implementation follows the attached `sybclint-api-docs.md`.

**Wallet selection:** `GET /v1/wallets`; select by configured wallet UUID and require `provider=shamcash`, `status=active`.

**Invoice creation:** `POST /v1/invoices` with:

```json
{
  "amount": "18000.00",
  "currency": "SYP",
  "walletAddress": "WALLET_UUID",
  "provider": "shamcash",
  "expiresInMinutes": 15,
  "note": "Nexa Store order reference",
  "metadata": {"orderId": "NX-...", "source": "nexa-store"}
}
```

**Transaction lookup:** `GET /v1/wallets/shamcash/{walletAddress}/transactions/{tranId}`. Nexa validates `data.found`, `data.transaction.tran_id`, `type=credit`, `currency`, `amount`, `datetime`, and `data.account.account_address`.

**Invoice verification:** `POST /v1/invoices/{invoiceNumber}/verify` with `{"transactionRef":"..."}`, then `GET /v1/invoices/{invoiceNumber}`. The final check requires `status=paid`, `method=shamcash`, matching `transactionRef`, invoice identifier and amount, and exact `paidAmount`.

The provider docs mention a 1% tolerance for invoice amount mismatch; this application independently enforces strict exact equality before and after provider verification.
