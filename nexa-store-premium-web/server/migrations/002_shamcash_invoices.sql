ALTER TABLE nexa_orders
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS invoice_identifier TEXT,
  ADD COLUMN IF NOT EXISTS wallet_label TEXT,
  ADD COLUMN IF NOT EXISTS wallet_address TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS nexa_orders_invoice_number_unique
  ON nexa_orders(invoice_number) WHERE invoice_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS nexa_api_throttles (
  throttle_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  next_allowed_at TIMESTAMPTZ NOT NULL
);
