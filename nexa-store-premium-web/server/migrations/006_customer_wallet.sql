CREATE TABLE IF NOT EXISTS nexa_customers (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nexa_customer_sessions (
  token_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES nexa_customers(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS nexa_customer_sessions_customer_idx ON nexa_customer_sessions(customer_id, expires_at);

CREATE TABLE IF NOT EXISTS nexa_customer_wallets (
  customer_id TEXT PRIMARY KEY REFERENCES nexa_customers(id) ON DELETE CASCADE,
  balance_minor BIGINT NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'SYP' CHECK (currency = 'SYP'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nexa_wallet_ledger (
  id BIGSERIAL PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES nexa_customers(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('topup','purchase','refund','adjustment')),
  direction TEXT NOT NULL CHECK (direction IN ('credit','debit')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'SYP' CHECK (currency = 'SYP'),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  balance_after_minor BIGINT NOT NULL CHECK (balance_after_minor >= 0),
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(customer_id, source_type, source_id, entry_type)
);
CREATE INDEX IF NOT EXISTS nexa_wallet_ledger_customer_created_idx ON nexa_wallet_ledger(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS nexa_wallet_topups (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES nexa_customers(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'SYP' CHECK (currency = 'SYP'),
  invoice_number TEXT NOT NULL UNIQUE,
  invoice_identifier TEXT NOT NULL,
  wallet_label TEXT NOT NULL DEFAULT '',
  wallet_address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','cancelled')),
  transaction_id TEXT UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS nexa_wallet_topups_customer_created_idx ON nexa_wallet_topups(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS nexa_payment_references (
  transaction_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('order','wallet_topup')),
  source_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_type, source_id)
);
INSERT INTO nexa_payment_references(transaction_id,source_type,source_id,created_at)
SELECT transaction_id,'order',order_id,created_at FROM nexa_payments
ON CONFLICT DO NOTHING;

ALTER TABLE nexa_orders
  ADD COLUMN IF NOT EXISTS customer_id TEXT REFERENCES nexa_customers(id),
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'shamcash';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nexa_orders_payment_method_check'
      AND conrelid = 'nexa_orders'::regclass
  ) THEN
    ALTER TABLE nexa_orders
      ADD CONSTRAINT nexa_orders_payment_method_check
      CHECK (payment_method IN ('shamcash','wallet'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS nexa_orders_customer_created_idx ON nexa_orders(customer_id, created_at DESC);
