import { useMemo, useState } from 'react';
import {
  useAccount,
  usePublicClient,
  useWriteContract,
} from 'wagmi';
import { formatUnits, maxUint256, parseUnits } from 'viem';
import type { Address } from 'viem';
import { erc20Abi } from '@/lib/abis/erc20';
import { aaveOracleAbi } from '@/lib/abis/oracle';
import {
  INTEREST_RATE_VARIABLE,
  poolAbi,
} from '@/lib/abis/pool';
import {
  swapRouter02Abi,
  quoterV2Abi,
  UNISWAP_FEE_TIERS,
  UNISWAP_V3_QUOTER_V2,
  UNISWAP_V3_SWAP_ROUTER_02,
} from '@/lib/abis/uniswap';
import { DEFAULT_MARKET } from '@/lib/chains';
import { useReserves, type ReserveRow } from '@/hooks/useReserves';
import { useTokenBalance } from '@/hooks/useTokenBalance';

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
      // No liquidity at this tier — skip.
    }
  }
  if (!best) throw new Error('No Uniswap V3 pool found for this pair');
  return best;
}

export function LoopWizard({ onClose }: Props) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { rows } = useReserves();

  const [collatAddr, setCollatAddr] = useState<Address | ''>('');
  const [debtAddr, setDebtAddr] = useState<Address | ''>('');
  const [initialAmountStr, setInitialAmountStr] = useState('');
  const [iterations, setIterations] = useState(2);
  const [ltvPct, setLtvPct] = useState(70);
  const [slippagePct, setSlippagePct] = useState(0.5);

  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const activeReserves = rows.filter((r) => r.isActive && !r.isFrozen);
  const borrowable = activeReserves.filter((r) => r.borrowEnabled);

  const collat = activeReserves.find((r) => r.asset === collatAddr);
  const debt = borrowable.find((r) => r.asset === debtAddr);
  const collatBalance = useTokenBalance(collat?.asset, address);

  const initialAmount = useMemo<bigint>(() => {
    if (!collat || !initialAmountStr) return 0n;
    try {
      return parseUnits(initialAmountStr, collat.decimals);
    } catch {
      return 0n;
    }
  }, [collat, initialAmountStr]);

  const projection = useMemo(() => {
    if (!collat || !debt || initialAmount === 0n) return null;
    const r = ltvPct / 100;
    // supplied = initial × (1 - r^(n+1)) / (1 - r)
    // debt = initial × r × (1 - r^n) / (1 - r)
    const pow = (x: number, n: number) => Math.pow(x, n);
    const supplied =
      r === 1
        ? initialAmount * BigInt(iterations + 1)
        : BigInt(
            Math.floor(
              Number(initialAmount) * ((1 - pow(r, iterations + 1)) / (1 - r)),
            ),
          );
    const debtValueInCollat =
      r === 1
        ? initialAmount * BigInt(iterations)
        : BigInt(
            Math.floor(
              Number(initialAmount) * r * ((1 - pow(r, iterations)) / (1 - r)),
            ),
          );
    const leverage = Number(supplied) / Number(initialAmount);
    // Simplified HF = supplied × liqThreshold / debt
    const hf =
      debtValueInCollat === 0n
        ? Infinity
        : (Number(supplied) * (collat.liquidationThresholdBps / 10000)) /
          Number(debtValueInCollat);
    return {
      suppliedCollatUnits: supplied,
      debtValueInCollat,
      leverage,
      hf,
    };
  }, [collat, debt, initialAmount, iterations, ltvPct]);

  function updateStep(idx: number, patch: Partial<Step>) {
    setSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  }

  async function execute() {
    if (!address || !collat || !debt || initialAmount === 0n || !publicClient) {
      return;
    }
    setGlobalError(null);
    setFinished(false);
    setRunning(true);

    const plan: Step[] = [
      { label: `Approve Pool on ${collat.symbol}`, status: 'pending' },
      {
        label: `Supply initial ${formatUnits(initialAmount, collat.decimals)} ${collat.symbol}`,
        status: 'pending',
      },
      { label: `Approve Uniswap Router on ${debt.symbol}`, status: 'pending' },
    ];
    for (let i = 0; i < iterations; i++) {
      plan.push({
        label: `Iter ${i + 1} · Borrow ${debt.symbol}`,
        status: 'pending',
      });
      plan.push({
        label: `Iter ${i + 1} · Swap ${debt.symbol} → ${collat.symbol}`,
        status: 'pending',
      });
      plan.push({
        label: `Iter ${i + 1} · Supply ${collat.symbol}`,
        status: 'pending',
      });
    }
    setSteps(plan);

    const safetyBps = BigInt(Math.round(ltvPct * 100));
    const slippageBps = BigInt(Math.round(slippagePct * 100));

    try {
      // Step 0: approve Pool on collateral (if needed)
      updateStep(0, { status: 'running' });
      const poolAllowance = await publicClient.readContract({
        address: collat.asset,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, DEFAULT_MARKET.pool],
      });
      if ((poolAllowance as bigint) < initialAmount) {
        const h = await writeContractAsync({
          address: collat.asset,
          abi: erc20Abi,
          functionName: 'approve',
          args: [DEFAULT_MARKET.pool, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
        updateStep(0, { status: 'success', txHash: h });
      } else {
        updateStep(0, { status: 'skipped' });
      }

      // Step 1: initial supply
      updateStep(1, { status: 'running' });
      const h1 = await writeContractAsync({
        address: DEFAULT_MARKET.pool,
        abi: poolAbi,
        functionName: 'supply',
        args: [collat.asset, initialAmount, address, 0],
      });
      await publicClient.waitForTransactionReceipt({ hash: h1 });
      updateStep(1, { status: 'success', txHash: h1 });

      // Step 2: approve Router on debt (if needed)
      updateStep(2, { status: 'running' });
      const routerAllowance = await publicClient.readContract({
        address: debt.asset,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, UNISWAP_V3_SWAP_ROUTER_02],
      });
      if ((routerAllowance as bigint) === 0n) {
        const h = await writeContractAsync({
          address: debt.asset,
          abi: erc20Abi,
          functionName: 'approve',
          args: [UNISWAP_V3_SWAP_ROUTER_02, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
        updateStep(2, { status: 'success', txHash: h });
      } else {
        updateStep(2, { status: 'skipped' });
      }

      // Iterations
      for (let i = 0; i < iterations; i++) {
        const baseIdx = 3 + i * 3;

        // Borrow
        updateStep(baseIdx, { status: 'running' });
        const accountData = await publicClient.readContract({
          address: DEFAULT_MARKET.pool,
          abi: poolAbi,
          functionName: 'getUserAccountData',
          args: [address],
        });
        const availableBorrowsBase = accountData[2];
        const debtPrice = await publicClient.readContract({
          address: DEFAULT_MARKET.aaveOracle,
          abi: aaveOracleAbi,
          functionName: 'getAssetPrice',
          args: [debt.asset],
        });
        // borrow = availableBase × safetyBps / 10000 × 10^debtDecimals / debtPrice
        const borrowBase = (availableBorrowsBase * safetyBps) / 10_000n;
        const borrowAmount =
          (borrowBase * 10n ** BigInt(debt.decimals)) / (debtPrice as bigint);
        if (borrowAmount === 0n) {
          throw new Error(
            `Iter ${i + 1}: available borrow is zero. LTV too high, prior step failed, or no headroom.`,
          );
        }
        const hBorrow = await writeContractAsync({
          address: DEFAULT_MARKET.pool,
          abi: poolAbi,
          functionName: 'borrow',
          args: [
            debt.asset,
            borrowAmount,
            INTEREST_RATE_VARIABLE,
            0,
            address,
          ],
        });
        await publicClient.waitForTransactionReceipt({ hash: hBorrow });
        updateStep(baseIdx, { status: 'success', txHash: hBorrow });

        // Swap
        updateStep(baseIdx + 1, { status: 'running' });
        const quote = await bestFeeTier(
          publicClient,
          debt.asset,
          collat.asset,
          borrowAmount,
        );
        const amountOutMin =
          (quote.amountOut * (10_000n - slippageBps)) / 10_000n;
        const hSwap = await writeContractAsync({
          address: UNISWAP_V3_SWAP_ROUTER_02,
          abi: swapRouter02Abi,
          functionName: 'exactInputSingle',
          args: [
            {
              tokenIn: debt.asset,
              tokenOut: collat.asset,
              fee: quote.fee,
              recipient: address,
              amountIn: borrowAmount,
              amountOutMinimum: amountOutMin,
              sqrtPriceLimitX96: 0n,
            },
          ],
        });
        await publicClient.waitForTransactionReceipt({ hash: hSwap });
        updateStep(baseIdx + 1, { status: 'success', txHash: hSwap });

        // Supply (use full wallet balance of collat, since that's what swap dropped)
        updateStep(baseIdx + 2, { status: 'running' });
        const collatBal = await publicClient.readContract({
          address: collat.asset,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        });
        if ((collatBal as bigint) === 0n) {
          throw new Error(`Iter ${i + 1}: zero collateral received from swap`);
        }
        const hSupply = await writeContractAsync({
          address: DEFAULT_MARKET.pool,
          abi: poolAbi,
          functionName: 'supply',
          args: [collat.asset, collatBal as bigint, address, 0],
        });
        await publicClient.waitForTransactionReceipt({ hash: hSupply });
        updateStep(baseIdx + 2, { status: 'success', txHash: hSupply });
      }

      setFinished(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Loop failed';
      setGlobalError(msg);
      setSteps((prev) => {
        const running = prev.findIndex((s) => s.status === 'running');
        if (running === -1) return prev;
        return prev.map((s, i) =>
          i === running ? { ...s, status: 'error', error: msg } : s,
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
    initialAmount > 0n &&
    initialAmount <= ((collatBalance.data as bigint | undefined) ?? 0n) &&
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
            <h3 className="text-lg font-semibold">Leverage (Loop)</h3>
            <p className="text-xs text-muted mt-1">
              Supply collateral, borrow against it, swap to more collateral,
              supply again. Multi-tx — you'll sign each step.
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

        {steps.length === 0 ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <AssetSelect
                label="Collateral (supply)"
                reserves={activeReserves}
                value={collatAddr}
                onChange={setCollatAddr}
              />
              <AssetSelect
                label="Debt (borrow)"
                reserves={borrowable}
                value={debtAddr}
                onChange={setDebtAddr}
              />
            </div>

            {collat && (
              <div>
                <label className="stat-label mb-2 block">
                  Initial {collat.symbol} to supply
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={initialAmountStr}
                    onChange={(e) => {
                      const v = e.target.value.replace(/,/g, '.');
                      if (v === '' || /^[0-9]*\.?[0-9]*$/.test(v)) {
                        setInitialAmountStr(v);
                      }
                    }}
                    placeholder="0.00"
                    className="w-full bg-bg border border-border rounded-lg px-4 py-3 font-mono focus:outline-none focus:border-accent/60"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted text-sm">
                    {collat.symbol}
                  </span>
                </div>
                <div className="text-xs text-muted mt-1">
                  Wallet balance:{' '}
                  <span className="font-mono">
                    {formatUnits(
                      (collatBalance.data as bigint | undefined) ?? 0n,
                      collat.decimals,
                    )}
                  </span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              <NumField
                label="Iterations"
                value={iterations}
                onChange={setIterations}
                min={1}
                max={5}
                step={1}
              />
              <NumField
                label="Per-iter LTV %"
                value={ltvPct}
                onChange={setLtvPct}
                min={10}
                max={collat ? collat.ltvBps / 100 : 80}
                step={1}
                help={
                  collat
                    ? `Asset max LTV: ${(collat.ltvBps / 100).toFixed(0)}%`
                    : undefined
                }
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

            {projection && (
              <div className="card !p-4 bg-bg/60">
                <div className="stat-label mb-2">Projected</div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <ProjStat label="Leverage" value={`${projection.leverage.toFixed(2)}×`} />
                  <ProjStat
                    label="Projected HF"
                    value={
                      isFinite(projection.hf)
                        ? projection.hf.toFixed(2)
                        : '∞'
                    }
                    tone={
                      projection.hf < 1.1
                        ? 'text-bad'
                        : projection.hf < 1.5
                          ? 'text-warn'
                          : 'text-good'
                    }
                  />
                  <ProjStat
                    label="Signatures"
                    value={`~${3 + 3 * iterations}`}
                  />
                </div>
                <div className="text-xs text-muted mt-3 leading-relaxed">
                  Projection is an approximation — assumes stable prices, uses
                  the collateral reserve's liquidation threshold, and ignores
                  swap fees/slippage. Real post-loop HF may differ.
                </div>
              </div>
            )}

            <div className="text-xs text-warn bg-warn/10 border border-warn/30 rounded-lg p-3 leading-relaxed">
              <strong>Looping is risky.</strong> Each iteration pushes your
              health factor closer to the liquidation threshold. Price moves
              during the multi-tx sequence can lead to liquidation between
              steps. Start small. Not financial advice.
            </div>

            <button
              onClick={execute}
              disabled={!canExecute}
              className="w-full bg-accent text-bg font-medium rounded-lg py-3 hover:bg-accent/90 disabled:opacity-40"
            >
              {canExecute ? 'Plan & Execute Loop' : 'Fill out the form'}
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
                ✓ Loop complete. Check your position in the table below.
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
                  {finished ? 'New Loop' : 'Back to Form'}
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
  help,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  help?: string;
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
      {help && <div className="text-xs text-muted mt-1">{help}</div>}
    </div>
  );
}

function ProjStat({
  label,
  value,
  tone = 'text-fg',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <div className="stat-label mb-1">{label}</div>
      <div className={`font-mono text-lg tabular-nums ${tone}`}>{value}</div>
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
