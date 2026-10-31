CREATE TABLE IF NOT EXISTS nexa_customers (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 70),
  phone TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  balance_minor BIGINT NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS nexa_customer_sessions (
  session_hash CHAR(64) PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES nexa_customers(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS nexa_customer_sessions_customer_idx ON nexa_customer_sessions(customer_id);
CREATE INDEX IF NOT EXISTS nexa_customer_sessions_expiry_idx ON nexa_customer_sessions(expires_at);

ALTER TABLE nexa_orders
  ADD COLUMN IF NOT EXISTS customer_id TEXT REFERENCES nexa_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wallet_topup_customer_id TEXT REFERENCES nexa_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'shamcash';

CREATE TABLE IF NOT EXISTS nexa_wallet_ledger (
  id BIGSERIAL PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES nexa_customers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('topup','purchase','refund','adjustment')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  balance_after_minor BIGINT NOT NULL CHECK (balance_after_minor >= 0),
  reference_order_id TEXT NOT NULL UNIQUE REFERENCES nexa_orders(id),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS nexa_wallet_ledger_customer_created_idx
  ON nexa_wallet_ledger(customer_id,created_at DESC);
