import { formatUnits } from 'viem';

const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31_536_000;

// Aave V3 reports getUserAccountData values in 8-decimal USD base currency.
const BASE_CURRENCY_DECIMALS = 8;

export function formatUsd(valueBase: bigint, fractionDigits = 2): string {
  const num = Number(formatUnits(valueBase, BASE_CURRENCY_DECIMALS));
  return num.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatPercent(bps: bigint, fractionDigits = 2): string {
  // Aave LTV / liquidation threshold are reported in bps (10000 = 100%).
  const num = Number(bps) / 100;
  return `${num.toFixed(fractionDigits)}%`;
}

// Aave rates are in ray (1e27 scale). This returns the compound APY.
export function rayToApy(rate: bigint): number {
  if (rate === 0n) return 0;
  const ratePerSecond = Number(rate) / Number(RAY) / SECONDS_PER_YEAR;
  return (1 + ratePerSecond) ** SECONDS_PER_YEAR - 1;
}

export function formatApy(rate: bigint, fractionDigits = 2): string {
  const apy = rayToApy(rate) * 100;
  return `${apy.toFixed(fractionDigits)}%`;
}

// Health factor is in WAD (1e18). Values >= 2^256-1 effectively mean "no debt".
export function formatHealthFactor(hf: bigint): string {
  const MAX = 2n ** 256n - 1n;
  if (hf === MAX || hf > 10n ** 40n) return '∞';
  const num = Number(formatUnits(hf, 18));
  if (num > 1000) return '> 1000';
  return num.toFixed(2);
}

export function healthFactorTone(hf: bigint): 'good' | 'warn' | 'bad' | 'neutral' {
  if (hf >= 10n ** 40n) return 'neutral';
  const num = Number(formatUnits(hf, 18));
  if (num < 1.1) return 'bad';
  if (num < 1.5) return 'warn';
  return 'good';
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
