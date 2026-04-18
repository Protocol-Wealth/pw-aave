import { useMemo, useState } from 'react';
import {
  useAccount,
  usePublicClient,
  useWriteContract,
} from 'wagmi';
import { formatUnits, maxUint256, parseUnits } from 'viem';
import type { Address } from 'viem';
import { erc20Abi } from '@/lib/abis/erc20';
import {
  INTEREST_RATE_VARIABLE,
  poolAbi,
} from '@/lib/abis/pool';
import {
  quoterV2Abi,
  swapRouter02Abi,
  UNISWAP_FEE_TIERS,
  UNISWAP_V3_QUOTER_V2,
  UNISWAP_V3_SWAP_ROUTER_02,
} from '@/lib/abis/uniswap';
import { DEFAULT_MARKET } from '@/lib/chains';
import { useReserves, type ReserveRow } from '@/hooks/useReserves';
import { useUserReserveBalances } from '@/hooks/useUserReserveBalances';

type StepStatus = 'pending' | 'running' | 'success' | 'skipped' | 'error';

type Step = {
  label: string;
  status: StepStatus;
  txHash?: `0x${string}`;
  error?: string;
};

type Props = {
  onClose: () => void;
};

async function bestFeeTier(
  publicClient: ReturnType<typeof usePublicClient>,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
): Promise<{ fee: number; amountOut: bigint }> {
  let best: { fee: number; amountOut: bigint } | null = null;
  for (const fee of UNISWAP_FEE_TIERS) {
    try {
      const result = await publicClient!.readContract({
        address: UNISWAP_V3_QUOTER_V2,
        abi: quoterV2Abi,
        functionName: 'quoteExactInputSingle',
        args: [
          { tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n },
        ],
      });
      const amountOut = result[0];
      if (!best || amountOut > best.amountOut) {
        best = { fee, amountOut };
      }
    } catch {
      // no pool at tier
    }
  }
  if (!best) throw new Error('No Uniswap V3 pool found for this pair');
  return best;
}

export function UnloopWizard({ onClose }: Props) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { rows } = useReserves();
  const { balancesByAsset } = useUserReserveBalances(rows, address);

  const [collatAddr, setCollatAddr] = useState<Address | ''>('');
  const [debtAddr, setDebtAddr] = useState<Address | ''>('');
  const [withdrawPerIterStr, setWithdrawPerIterStr] = useState('');
  const [iterations, setIterations] = useState(2);
  const [slippagePct, setSlippagePct] = useState(0.5);

  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const suppliedAssets = rows.filter(
    (r) => (balancesByAsset.get(r.asset)?.supplied ?? 0n) > 0n,
  );
  const debtAssets = rows.filter(
    (r) => (balancesByAsset.get(r.asset)?.variableDebt ?? 0n) > 0n,
  );

  const collat = suppliedAssets.find((r) => r.asset === collatAddr);
  const debt = debtAssets.find((r) => r.asset === debtAddr);

  const withdrawPerIter = useMemo<bigint>(() => {
    if (!collat || !withdrawPerIterStr) return 0n;
    try {
      return parseUnits(withdrawPerIterStr, collat.decimals);
    } catch {
      return 0n;
    }
  }, [collat, withdrawPerIterStr]);

  const collatSupplied = collat
    ? (balancesByAsset.get(collat.asset)?.supplied ?? 0n)
    : 0n;
  const debtBalance = debt
    ? (balancesByAsset.get(debt.asset)?.variableDebt ?? 0n)
    : 0n;

  const totalWithdraw = withdrawPerIter * BigInt(iterations);

  function updateStep(idx: number, patch: Partial<Step>) {
    setSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  }

  async function execute() {
    if (!address || !collat || !debt || withdrawPerIter === 0n || !publicClient) {
      return;
    }
    setGlobalError(null);
    setFinished(false);
    setRunning(true);

    const plan: Step[] = [
      { label: `Approve Uniswap Router on ${collat.symbol}`, status: 'pending' },
      { label: `Approve Pool on ${debt.symbol}`, status: 'pending' },
    ];
    for (let i = 0; i < iterations; i++) {
      plan.push({
        label: `Iter ${i + 1} · Withdraw ${formatUnits(withdrawPerIter, collat.decimals)} ${collat.symbol}`,
        status: 'pending',
      });
      plan.push({
        label: `Iter ${i + 1} · Swap ${collat.symbol} → ${debt.symbol}`,
        status: 'pending',
      });
      plan.push({
        label: `Iter ${i + 1} · Repay ${debt.symbol}`,
        status: 'pending',
      });
    }
    setSteps(plan);

    const slippageBps = BigInt(Math.round(slippagePct * 100));

    try {
      // Approve Router on collateral
      updateStep(0, { status: 'running' });
      const routerAllowance = await publicClient.readContract({
        address: collat.asset,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, UNISWAP_V3_SWAP_ROUTER_02],
      });
      if ((routerAllowance as bigint) < totalWithdraw) {
        const h = await writeContractAsync({
          address: collat.asset,
          abi: erc20Abi,
          functionName: 'approve',
          args: [UNISWAP_V3_SWAP_ROUTER_02, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
        updateStep(0, { status: 'success', txHash: h });
      } else {
        updateStep(0, { status: 'skipped' });
      }

      // Approve Pool on debt asset (for repay)
      updateStep(1, { status: 'running' });
      const poolAllowance = await publicClient.readContract({
        address: debt.asset,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, DEFAULT_MARKET.pool],
      });
      if ((poolAllowance as bigint) === 0n) {
        const h = await writeContractAsync({
          address: debt.asset,
          abi: erc20Abi,
          functionName: 'approve',
          args: [DEFAULT_MARKET.pool, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
        updateStep(1, { status: 'success', txHash: h });
      } else {
        updateStep(1, { status: 'skipped' });
      }

      // Iterations
      for (let i = 0; i < iterations; i++) {
        const baseIdx = 2 + i * 3;

        // Withdraw
        updateStep(baseIdx, { status: 'running' });
        const hWithdraw = await writeContractAsync({
          address: DEFAULT_MARKET.pool,
          abi: poolAbi,
          functionName: 'withdraw',
          args: [collat.asset, withdrawPerIter, address],
        });
        await publicClient.waitForTransactionReceipt({ hash: hWithdraw });
        updateStep(baseIdx, { status: 'success', txHash: hWithdraw });

        // Swap collat → debt
        updateStep(baseIdx + 1, { status: 'running' });
        const quote = await bestFeeTier(
          publicClient,
          collat.asset,
          debt.asset,
          withdrawPerIter,
        );
        const amountOutMin =
          (quote.amountOut * (10_000n - slippageBps)) / 10_000n;
        const hSwap = await writeContractAsync({
          address: UNISWAP_V3_SWAP_ROUTER_02,
          abi: swapRouter02Abi,
          functionName: 'exactInputSingle',
          args: [
            {
              tokenIn: collat.asset,
              tokenOut: debt.asset,
              fee: quote.fee,
              recipient: address,
              amountIn: withdrawPerIter,
              amountOutMinimum: amountOutMin,
              sqrtPriceLimitX96: 0n,
            },
          ],
        });
        await publicClient.waitForTransactionReceipt({ hash: hSwap });
        updateStep(baseIdx + 1, { status: 'success', txHash: hSwap });

        // Repay — cap at current debt to avoid "no debt" revert
        updateStep(baseIdx + 2, { status: 'running' });
        const walletDebtBal = await publicClient.readContract({
          address: debt.asset,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        });
        const currentDebt = await publicClient.readContract({
          address: debt.variableDebtTokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        });
        const repayAmount =
          (walletDebtBal as bigint) < (currentDebt as bigint)
            ? (walletDebtBal as bigint)
            : (currentDebt as bigint);
        if (repayAmount === 0n) {
          updateStep(baseIdx + 2, {
            status: 'skipped',
            error: 'No debt remaining',
          });
          break;
        }
        const hRepay = await writeContractAsync({
          address: DEFAULT_MARKET.pool,
          abi: poolAbi,
          functionName: 'repay',
          args: [debt.asset, repayAmount, INTEREST_RATE_VARIABLE, address],
        });
        await publicClient.waitForTransactionReceipt({ hash: hRepay });
        updateStep(baseIdx + 2, { status: 'success', txHash: hRepay });
      }

      setFinished(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unloop failed';
      setGlobalError(msg);
      setSteps((prev) => {
        const runningIdx = prev.findIndex((s) => s.status === 'running');
        if (runningIdx === -1) return prev;
        return prev.map((s, i) =>
          i === runningIdx ? { ...s, status: 'error', error: msg } : s,
        );
      });
    } finally {
      setRunning(false);
    }
  }

  const canExecute =
    !!address &&
    !!collat &&
    !!debt &&
    collat.asset !== debt.asset &&
    withdrawPerIter > 0n &&
    totalWithdraw <= collatSupplied &&
    !running;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-auto"
      onClick={() => !running && onClose()}
    >
      <div
        className="bg-surface border border-border rounded-xl w-full max-w-2xl p-6 space-y-5 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">Unloop (Deleverage)</h3>
            <p className="text-xs text-muted mt-1">
              Withdraw collateral, swap to debt asset, repay. Multi-tx — you'll
              sign each step. Does not close the whole position in one shot.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={running}
            className="text-muted hover:text-fg text-xl leading-none disabled:opacity-30"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {suppliedAssets.length === 0 || debtAssets.length === 0 ? (
          <div className="text-sm text-muted bg-bg/60 border border-border rounded-lg p-4">
            Unloop requires an active position (both supplied collateral and
            outstanding debt). You don't have one right now.
          </div>
        ) : steps.length === 0 ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <AssetSelect
                label="Collateral to reduce"
                reserves={suppliedAssets}
                value={collatAddr}
                onChange={setCollatAddr}
              />
              <AssetSelect
                label="Debt to repay"
                reserves={debtAssets}
                value={debtAddr}
                onChange={setDebtAddr}
              />
            </div>

            {collat && (
              <div>
                <label className="stat-label mb-2 block">
                  Withdraw per iteration ({collat.symbol})
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={withdrawPerIterStr}
                    onChange={(e) => {
                      const v = e.target.value.replace(/,/g, '.');
                      if (v === '' || /^[0-9]*\.?[0-9]*$/.test(v)) {
                        setWithdrawPerIterStr(v);
                      }
                    }}
                    placeholder="0.00"
                    className="w-full bg-bg border border-border rounded-lg px-4 py-3 font-mono focus:outline-none focus:border-accent/60"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted text-sm">
                    {collat.symbol}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted mt-1">
                  <span>
                    Currently supplied:{' '}
                    <span className="font-mono">
                      {formatUnits(collatSupplied, collat.decimals)}
                    </span>
                  </span>
                  {debt && (
                    <span>
                      Debt:{' '}
                      <span className="font-mono">
                        {formatUnits(debtBalance, debt.decimals)}{' '}
                        {debt.symbol}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <NumField
                label="Iterations"
                value={iterations}
                onChange={setIterations}
                min={1}
                max={5}
                step={1}
              />
              <NumField
                label="Slippage %"
                value={slippagePct}
                onChange={setSlippagePct}
                min={0.05}
                max={5}
                step={0.05}
              />
            </div>

            {collat && withdrawPerIter > 0n && (
              <div className="card !p-4 bg-bg/60">
                <div className="stat-label mb-2">Plan</div>
                <div className="text-sm space-y-1">
                  <div>
                    Total withdraw:{' '}
                    <span className="font-mono">
                      {formatUnits(totalWithdraw, collat.decimals)}{' '}
                      {collat.symbol}
                    </span>
                  </div>
                  <div className="text-xs text-muted">
                    Signatures: ~{2 + 3 * iterations} (2 one-time approves + 3
                    per iteration).
                  </div>
                </div>
                {totalWithdraw > collatSupplied && (
                  <div className="text-xs text-bad mt-2">
                    Total withdraw exceeds current supplied balance.
                  </div>
                )}
              </div>
            )}

            <div className="text-xs text-warn bg-warn/10 border border-warn/30 rounded-lg p-3 leading-relaxed">
              <strong>Pre-check health factor between steps.</strong>{' '}
              Withdrawing too much in one iteration can push HF toward
              liquidation. Start small. The tx reverts if HF would go below
              1.0, but by then you've wasted gas.
            </div>

            <button
              onClick={execute}
              disabled={!canExecute}
              className="w-full bg-accent text-bg font-medium rounded-lg py-3 hover:bg-accent/90 disabled:opacity-40"
            >
              {canExecute ? 'Execute Unloop' : 'Fill out the form'}
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <div className="stat-label">Execution</div>
            {steps.map((s, i) => (
              <StepRow key={i} step={s} />
            ))}
            {globalError && (
              <div className="text-xs text-bad bg-bad/10 border border-bad/30 rounded-lg p-3 break-words">
                {globalError}
              </div>
            )}
            {finished && (
              <div className="text-sm text-good bg-good/10 border border-good/30 rounded-lg p-3">
                ✓ Unloop complete. Position updated.
              </div>
            )}
            {!running && (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setSteps([]);
                    setGlobalError(null);
                    setFinished(false);
                  }}
                  className="flex-1 border border-border rounded-lg py-2 text-sm hover:border-accent/60"
                >
                  {finished ? 'New Unloop' : 'Back to Form'}
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 bg-accent text-bg rounded-lg py-2 text-sm hover:bg-accent/90"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetSelect({
  label,
  reserves,
  value,
  onChange,
}: {
  label: string;
  reserves: ReserveRow[];
  value: Address | '';
  onChange: (v: Address) => void;
}) {
  return (
    <div>
      <label className="stat-label mb-2 block">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Address)}
        className="w-full bg-bg border border-border rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-accent/60"
      >
        <option value="">Select asset…</option>
        {reserves.map((r) => (
          <option key={r.asset} value={r.asset}>
            {r.symbol}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div>
      <label className="stat-label mb-2 block">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full bg-bg border border-border rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:border-accent/60"
      />
    </div>
  );
}

function StepRow({ step }: { step: Step }) {
  const icon = {
    pending: '○',
    running: '◔',
    success: '✓',
    skipped: '–',
    error: '✗',
  }[step.status];
  const color = {
    pending: 'text-muted',
    running: 'text-accent animate-pulse',
    success: 'text-good',
    skipped: 'text-muted',
    error: 'text-bad',
  }[step.status];
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={`font-mono w-5 ${color}`}>{icon}</span>
      <span className="flex-1">{step.label}</span>
      {step.txHash && (
        <a
          href={`https://etherscan.io/tx/${step.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted hover:text-fg font-mono"
        >
          {step.txHash.slice(0, 8)}…
        </a>
      )}
    </div>
  );
}
