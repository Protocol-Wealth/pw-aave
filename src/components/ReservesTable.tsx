import { useReserves } from '@/hooks/useReserves';
import { formatApy, shortAddress } from '@/lib/format';

export function ReservesTable() {
  const { rows, isLoading, isError } = useReserves();

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

  const sorted = [...rows].sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );

  return (
    <div className="card overflow-x-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold">Aave V3 Markets</h2>
        <span className="text-xs text-muted">{sorted.length} reserves</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted uppercase tracking-wider">
            <th className="pb-3 font-medium">Asset</th>
            <th className="pb-3 font-medium">Address</th>
            <th className="pb-3 font-medium text-right">Supply APY</th>
            <th className="pb-3 font-medium text-right">Borrow APY</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.asset}
              className="border-t border-border hover:bg-bg/40 transition-colors"
            >
              <td className="py-3 font-medium">{r.symbol}</td>
              <td className="py-3 font-mono text-xs text-muted">
                <a
                  href={`https://etherscan.io/address/${r.asset}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-fg"
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
