// Fixed store exchange rate: 145 new Syrian pounds for 1 US dollar.
export const SYP_PER_USD = 145;
const RATE_SCALE = 10_000n;
export function convertSypMinorToUsdMinor(sypMinor) {
  const amount = typeof sypMinor === 'bigint' ? sypMinor : BigInt(sypMinor);
  if (amount < 0n) throw new RangeError('SYP amount cannot be negative');
  const rateScaled = BigInt(SYP_PER_USD) * RATE_SCALE;
  return (amount * RATE_SCALE + rateScaled / 2n) / rateScaled;
}
