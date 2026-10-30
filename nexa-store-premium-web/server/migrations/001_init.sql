CREATE TABLE IF NOT EXISTS nexa_orders (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  pack_index INTEGER NOT NULL,
  product_label TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  game_account TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','paid','expired','cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS nexa_payments (
  id BIGSERIAL PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL UNIQUE REFERENCES nexa_orders(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  receiver_wallet_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nexa_orders_status_expires_idx ON nexa_orders(status, expires_at);
CREATE INDEX IF NOT EXISTS nexa_payments_order_id_idx ON nexa_payments(order_id);
