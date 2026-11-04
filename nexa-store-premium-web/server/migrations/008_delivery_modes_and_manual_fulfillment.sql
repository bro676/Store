ALTER TABLE nexa_orders
  ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'automatic',
  ADD COLUMN IF NOT EXISTS delivery_eta_hours INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS delivery_customer_message TEXT NOT NULL DEFAULT '';

-- Historical orders retain the compatibility default. New orders snapshot
-- their chosen product delivery policy explicitly during checkout.

UPDATE nexa_orders
SET delivery_eta_hours = 24
WHERE delivery_eta_hours IS NULL OR delivery_eta_hours < 1 OR delivery_eta_hours > 720;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nexa_orders_delivery_mode_check'
      AND conrelid = 'nexa_orders'::regclass
  ) THEN
    ALTER TABLE nexa_orders
      ADD CONSTRAINT nexa_orders_delivery_mode_check
      CHECK (delivery_mode IN ('automatic', 'manual'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nexa_orders_delivery_eta_check'
      AND conrelid = 'nexa_orders'::regclass
  ) THEN
    ALTER TABLE nexa_orders
      ADD CONSTRAINT nexa_orders_delivery_eta_check
      CHECK (delivery_eta_hours BETWEEN 1 AND 720);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS nexa_orders_delivery_status_idx
  ON nexa_orders(delivery_mode, supplier_status, created_at DESC);
