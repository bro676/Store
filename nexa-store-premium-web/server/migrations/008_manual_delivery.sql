ALTER TABLE nexa_orders
  ADD COLUMN IF NOT EXISTS delivery_eta_hours INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS delivery_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_delivery_message TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nexa_orders_delivery_eta_hours_check'
      AND conrelid = 'nexa_orders'::regclass
  ) THEN
    ALTER TABLE nexa_orders
      ADD CONSTRAINT nexa_orders_delivery_eta_hours_check
      CHECK (delivery_eta_hours BETWEEN 1 AND 720);
  END IF;
END $$;

