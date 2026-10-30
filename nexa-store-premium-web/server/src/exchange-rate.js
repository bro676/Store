// Store default: 145 new Syrian pounds for 1 US dollar.
export const SYP_PER_USD = 145;
const RATE_SCALE = 1_000_000n;

export function convertSypMinorToUsdMinor(sypMinor, sypPerUsd = SYP_PER_USD) {
  const amount = typeof sypMinor === 'bigint' ? sypMinor : BigInt(sypMinor);
  const rate = Number(sypPerUsd);
  if (amount < 0n) throw new RangeError('SYP amount cannot be negative');
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1_000_000) throw new RangeError('Invalid SYP per USD rate');
  const rateScaled = BigInt(Math.round(rate * Number(RATE_SCALE)));
  if (rateScaled <= 0n) throw new RangeError('Invalid SYP per USD rate');
  return (amount * RATE_SCALE + rateScaled / 2n) / rateScaled;
}
