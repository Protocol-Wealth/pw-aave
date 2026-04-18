import { useAccount } from 'wagmi';
import { useUserAccountData } from '@/hooks/useUserAccountData';
import {
  formatHealthFactor,
  formatPercent,
  formatUsd,
  healthFactorTone,
} from '@/lib/format';

export function PositionSummary() {
  const { address, isConnected } = useAccount();
  const { data, isLoading, isError } = useUserAccountData(address);

  if (!isConnected) {
    return (
      <div className="card">
        <p className="text-muted">
          Connect a wallet to view your Aave V3 position.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="card">
        <p className="text-muted">Loading position…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="card">
        <p className="text-bad">
          Failed to load position data. Check your RPC connection.
        </p>
      </div>
    );
  }

  const [
    totalCollateralBase,
    totalDebtBase,
    availableBorrowsBase,
    currentLiquidationThreshold,
    ltv,
    healthFactor,
  ] = data as readonly [bigint, bigint, bigint, bigint, bigint, bigint];

  const hfTone = healthFactorTone(healthFactor);
  const hfColor = {
    good: 'text-good',
    warn: 'text-warn',
    bad: 'text-bad',
    neutral: 'text-muted',
  }[hfTone];

  const hasPosition = totalCollateralBase > 0n || totalDebtBase > 0n;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      <Stat
        label="Health Factor"
        value={
          hasPosition ? formatHealthFactor(healthFactor) : '—'
        }
        tone={hasPosition ? hfColor : 'text-muted'}
      />
      <Stat label="Net Worth" value={formatUsd(totalCollateralBase - totalDebtBase)} />
      <Stat label="Total Collateral" value={formatUsd(totalCollateralBase)} />
      <Stat label="Total Debt" value={formatUsd(totalDebtBase)} />
      <Stat label="Available to Borrow" value={formatUsd(availableBorrowsBase)} />
      <Stat
        label="Current LTV / Liq. Threshold"
        value={
          hasPosition
            ? `${formatPercent(ltv, 1)} / ${formatPercent(currentLiquidationThreshold, 1)}`
            : '—'
        }
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'text-fg',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="card">
      <div className="stat-label mb-2">{label}</div>
      <div className={`stat-value ${tone}`}>{value}</div>
    </div>
  );
}
