CREATE TABLE IF NOT EXISTS nexa_customers (
  id UUID PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS nexa_customer_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES nexa_customers(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS nexa_customer_sessions_customer_idx ON nexa_customer_sessions(customer_id,expires_at);

CREATE TABLE IF NOT EXISTS nexa_customer_wallets (
  customer_id UUID NOT NULL REFERENCES nexa_customers(id) ON DELETE CASCADE,
  currency TEXT NOT NULL CHECK(currency IN ('SYP','USD')),
  balance_minor BIGINT NOT NULL DEFAULT 0 CHECK(balance_minor >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(customer_id,currency)
);

ALTER TABLE nexa_orders
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES nexa_customers(id),
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'shamcash'
    CHECK(payment_method IN ('shamcash','wallet'));
CREATE INDEX IF NOT EXISTS nexa_orders_customer_idx ON nexa_orders(customer_id,created_at DESC);

CREATE TABLE IF NOT EXISTS nexa_wallet_topups (
  id TEXT PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES nexa_customers(id),
  amount_minor BIGINT NOT NULL CHECK(amount_minor > 0),
  currency TEXT NOT NULL CHECK(currency IN ('SYP','USD')),
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK(status IN ('pending_payment','paid','expired','cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  invoice_identifier TEXT NOT NULL,
  wallet_label TEXT NOT NULL DEFAULT '',
  wallet_address TEXT NOT NULL DEFAULT '',
  transaction_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS nexa_wallet_topups_customer_idx ON nexa_wallet_topups(customer_id,created_at DESC);

CREATE TABLE IF NOT EXISTS nexa_verified_transactions (
  transaction_id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK(purpose IN ('order','wallet_topup')),
  reference_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO nexa_verified_transactions(transaction_id,purpose,reference_id)
SELECT transaction_id,'order',order_id FROM nexa_payments
ON CONFLICT(transaction_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS nexa_wallet_ledger (
  id BIGSERIAL PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES nexa_customers(id),
  type TEXT NOT NULL CHECK(type IN ('topup','purchase','refund','adjustment')),
  currency TEXT NOT NULL CHECK(currency IN ('SYP','USD')),
  amount_minor BIGINT NOT NULL CHECK(amount_minor > 0),
  order_id TEXT REFERENCES nexa_orders(id),
  topup_id TEXT REFERENCES nexa_wallet_topups(id),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS nexa_wallet_ledger_purchase_once ON nexa_wallet_ledger(order_id) WHERE type='purchase';
CREATE UNIQUE INDEX IF NOT EXISTS nexa_wallet_ledger_topup_once ON nexa_wallet_ledger(topup_id) WHERE type='topup';
CREATE INDEX IF NOT EXISTS nexa_wallet_ledger_customer_idx ON nexa_wallet_ledger(customer_id,id DESC);
