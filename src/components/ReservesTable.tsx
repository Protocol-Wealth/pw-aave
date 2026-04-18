import { useState } from 'react';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { useReserves, type ReserveRow } from '@/hooks/useReserves';
import { useUserReserveBalances } from '@/hooks/useUserReserveBalances';
import { formatApy, shortAddress } from '@/lib/format';
import { ActionModal, type ActionKind } from './ActionModal';

export function ReservesTable() {
  const { address, isConnected } = useAccount();
  const { rows, isLoading, isError } = useReserves();
  const { balancesByAsset } = useUserReserveBalances(rows, address);

  const [open, setOpen] = useState<{
    action: ActionKind;
    reserve: ReserveRow;
  } | null>(null);

  if (isLoading) {
    return (
      <div className="card">
        <p className="text-muted">Loading reserves…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="card">
        <p className="text-bad">Failed to load reserves.</p>
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => {
    // When connected, float reserves the user has positions in to the top.
    if (isConnected) {
      const ab = balancesByAsset.get(a.asset);
      const bb = balancesByAsset.get(b.asset);
      const aActive = (ab?.supplied ?? 0n) > 0n || (ab?.variableDebt ?? 0n) > 0n;
      const bActive = (bb?.supplied ?? 0n) > 0n || (bb?.variableDebt ?? 0n) > 0n;
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
    }
    return a.symbol.localeCompare(b.symbol);
  });

  return (
    <>
      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Aave V3 Markets</h2>
          <span className="text-xs text-muted">{sorted.length} reserves</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted uppercase tracking-wider">
              <th className="pb-3 font-medium">Asset</th>
              <th className="pb-3 font-medium text-right">Supply APY</th>
              <th className="pb-3 font-medium text-right">Borrow APY</th>
              {isConnected && (
                <>
                  <th className="pb-3 font-medium text-right">You Supplied</th>
                  <th className="pb-3 font-medium text-right">You Borrowed</th>
                </>
              )}
              <th className="pb-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const bal = balancesByAsset.get(r.asset);
              const hasSupply = (bal?.supplied ?? 0n) > 0n;
              const hasDebt = (bal?.variableDebt ?? 0n) > 0n;
              return (
                <tr
                  key={r.asset}
                  className="border-t border-border hover:bg-bg/40 transition-colors"
                >
                  <td className="py-3">
                    <div className="font-medium">{r.symbol}</div>
                    <a
                      href={`https://etherscan.io/address/${r.asset}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-muted hover:text-fg"
                    >
                      {shortAddress(r.asset)}
                    </a>
                  </td>
                  <td className="py-3 text-right font-mono tabular-nums text-good">
                    {formatApy(r.supplyApyRay)}
                  </td>
                  <td className="py-3 text-right font-mono tabular-nums">
                    {formatApy(r.borrowApyRay)}
                  </td>
                  {isConnected && (
                    <>
                      <td className="py-3 text-right font-mono tabular-nums text-xs">
                        {hasSupply
                          ? Number(
                              formatUnits(bal!.supplied, r.decimals),
                            ).toLocaleString(undefined, {
                              maximumFractionDigits: 4,
                            })
                          : '—'}
                      </td>
                      <td className="py-3 text-right font-mono tabular-nums text-xs">
                        {hasDebt
                          ? Number(
                              formatUnits(bal!.variableDebt, r.decimals),
                            ).toLocaleString(undefined, {
                              maximumFractionDigits: 4,
                            })
                          : '—'}
                      </td>
                    </>
                  )}
                  <td className="py-3 text-right">
                    <div className="inline-flex gap-1">
                      <ActionBtn
                        label="Supply"
                        onClick={() => setOpen({ action: 'supply', reserve: r })}
                        disabled={!isConnected}
                      />
                      <ActionBtn
                        label="Borrow"
                        onClick={() => setOpen({ action: 'borrow', reserve: r })}
                        disabled={!isConnected}
                      />
                      {hasSupply && (
                        <ActionBtn
                          label="Withdraw"
                          onClick={() =>
                            setOpen({ action: 'withdraw', reserve: r })
                          }
                        />
                      )}
                      {hasDebt && (
                        <ActionBtn
                          label="Repay"
                          onClick={() => setOpen({ action: 'repay', reserve: r })}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <ActionModal
          action={open.action}
          reserve={open.reserve}
          userBalance={balancesByAsset.get(open.reserve.asset)}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function ActionBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-xs border border-border hover:border-accent/60 hover:text-accent rounded px-2 py-1 transition-colors disabled:opacity-30 disabled:pointer-events-none"
    >
      {label}
    </button>
  );
}
