export function formatSignedUsd(value: number, decimals = 2): string {
  const safe = Number.isFinite(value) ? value : 0;
  const roundedZeroFix = Math.abs(safe) < 0.5 * Math.pow(10, -decimals) ? 0 : safe;
  const absFormatted = Math.abs(roundedZeroFix).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (roundedZeroFix > 0) return `+$${absFormatted}`;
  if (roundedZeroFix < 0) return `-$${absFormatted}`;
  return `$${absFormatted}`;
}

export function formatUsd(value: number, decimals = 2): string {
  const safe = Number.isFinite(value) ? value : 0;
  const roundedZeroFix = Math.abs(safe) < 0.5 * Math.pow(10, -decimals) ? 0 : safe;
  const absFormatted = Math.abs(roundedZeroFix).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return roundedZeroFix < 0 ? `-$${absFormatted}` : `$${absFormatted}`;
}

export function formatPx(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '0.00';
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (price >= 1) return price.toFixed(4);
  return price.toPrecision(5);
}
