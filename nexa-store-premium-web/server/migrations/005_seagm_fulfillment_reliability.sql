ALTER TABLE nexa_fulfillment_jobs
  ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0
  CHECK (failure_count >= 0);

-- The supplier worker distinguishes slow provider fulfillment polling from transient
-- transport/API failures. A pending supplier order can be checked for several hours,
-- while network/server failures have their own bounded retry counter.
