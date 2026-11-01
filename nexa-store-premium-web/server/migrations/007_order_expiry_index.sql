-- Speed up the periodic transition of expired unpaid invoices.
CREATE INDEX IF NOT EXISTS nexa_orders_pending_expiry_idx
  ON nexa_orders(expires_at)
  WHERE status='pending_payment';
