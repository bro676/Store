-- Persist the delivery mode and its SLA with each order.
-- Existing paid orders remain automatic; product-level choices only affect new orders.
ALTER TABLE nexa_orders
  ADD COLUMN IF NOT EXISTS fulfillment_mode TEXT NOT NULL DEFAULT 'automatic';

ALTER TABLE nexa_orders
  ADD COLUMN IF NOT EXISTS manual_delivery_hours INTEGER NOT NULL DEFAULT 24;

DO $$
BEGIN
  ALTER TABLE nexa_orders
    ADD CONSTRAINT nexa_orders_fulfillment_mode_check
    CHECK (fulfillment_mode IN ('automatic','manual'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE nexa_orders
    ADD CONSTRAINT nexa_orders_manual_delivery_hours_check
    CHECK (manual_delivery_hours BETWEEN 1 AND 168);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
