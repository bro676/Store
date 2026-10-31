ALTER TABLE nexa_orders
  ADD COLUMN IF NOT EXISTS supplier_provider TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_kind TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_category_id BIGINT,
  ADD COLUMN IF NOT EXISTS supplier_type_id BIGINT,
  ADD COLUMN IF NOT EXISTS supplier_quantity INTEGER NOT NULL DEFAULT 1 CHECK (supplier_quantity > 0),
  ADD COLUMN IF NOT EXISTS supplier_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS supplier_mch_order_id TEXT,
  ADD COLUMN IF NOT EXISTS supplier_order_id TEXT,
  ADD COLUMN IF NOT EXISTS supplier_status TEXT NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS supplier_message TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_result_encrypted TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_completed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS nexa_orders_supplier_mch_order_id_unique
  ON nexa_orders(supplier_mch_order_id)
  WHERE supplier_mch_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS nexa_fulfillment_jobs (
  order_id TEXT PRIMARY KEY REFERENCES nexa_orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','retry','completed','manual_review')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  provider_order_id TEXT,
  provider_status_code INTEGER,
  provider_status TEXT NOT NULL DEFAULT '',
  provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nexa_fulfillment_jobs_due_idx
  ON nexa_fulfillment_jobs(status, next_attempt_at)
  WHERE status IN ('pending','retry','processing');
