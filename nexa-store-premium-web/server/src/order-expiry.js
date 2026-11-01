export const EXPIRE_PENDING_ORDERS_SQL = `
  UPDATE nexa_orders
  SET status='expired'
  WHERE status='pending_payment'
    AND expires_at<=NOW()
  RETURNING id
`;

export async function expirePendingOrders(pool) {
  if (!pool || typeof pool.query !== 'function') return 0;
  const result = await pool.query(EXPIRE_PENDING_ORDERS_SQL);
  return Number(result?.rowCount || 0);
}
