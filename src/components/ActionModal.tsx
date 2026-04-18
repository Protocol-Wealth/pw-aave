import { useMemo, useState } from 'react';
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { formatUnits, parseUnits, maxUint256 } from 'viem';
import { erc20Abi } from '@/lib/abis/erc20';
import {
  INTEREST_RATE_VARIABLE,
  MAX_UINT256,
  poolAbi,
} from '@/lib/abis/pool';
import { DEFAULT_MARKET } from '@/lib/chains';
import { useTokenAllowance, useTokenBalance } from '@/hooks/useTokenBalance';
import { useUserAccountData } from '@/hooks/useUserAccountData';
import type { ReserveRow } from '@/hooks/useReserves';
import type { UserReserveBalance } from '@/hooks/useUserReserveBalances';
import { formatHealthFactor, healthFactorTone } from '@/lib/format';

export type ActionKind = 'supply' | 'withdraw' | 'borrow' | 'repay';

type Props = {
  action: ActionKind;
  reserve: ReserveRow;
  userBalance: UserReserveBalance | undefined;
  onClose: () => void;
};

const labels: Record<ActionKind, string> = {
  supply: 'Supply',
  withdraw: 'Withdraw',
  borrow: 'Borrow',
  repay: 'Repay',
};

// Approve (EIP-20) and repay both debit the user's wallet → need allowance.
const needsAllowance = (action: ActionKind) =>
  action === 'supply' || action === 'repay';

export function ActionModal({ action, reserve, userBalance, onClose }: Props) {
  const { address } = useAccount();
  const [amountStr, setAmountStr] = useState('');
  const [useMax, setUseMax] = useState(false);

  const walletBalanceQ = useTokenBalance(reserve.asset, address);
  const allowanceQ = useTokenAllowance(
    reserve.asset,
    address,
    DEFAULT_MARKET.pool,
  );
  const accountData = useUserAccountData(address);

  const { writeContractAsync, isPending: isSigning } = useWriteContract();
  const [pendingHash, setPendingHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | null>(null);

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: pendingHash,
    query: { enabled: Boolean(pendingHash) },
  });

  const maxAmount = useMemo<bigint>(() => {
    switch (action) {
      case 'supply':
        return (walletBalanceQ.data as bigint | undefined) ?? 0n;
      case 'withdraw':
        return userBalance?.supplied ?? 0n;
      case 'repay':
        return userBalance?.variableDebt ?? 0n;
      case 'borrow': {
        // availableBorrowsBase is in 8-decimal USD base; to convert to reserve
        // units we'd need the oracle price. For v0.2 we don't cap the input —
        // users see the health factor preview and can judge. If they overshoot,
        // the tx reverts.
        return 0n;
      }
    }
  }, [action, walletBalanceQ.data, userBalance]);

  const amountBig = useMemo<bigint>(() => {
    if (!amountStr) return 0n;
    try {
      return parseUnits(amountStr, reserve.decimals);
    } catch {
      return 0n;
    }
  }, [amountStr, reserve.decimals]);

  const hasAllowance = useMemo(() => {
    if (!needsAllowance(action)) return true;
    const current = (allowanceQ.data as bigint | undefined) ?? 0n;
    return current >= amountBig && amountBig > 0n;
  }, [action, allowanceQ.data, amountBig]);

  async function handleApprove() {
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: reserve.asset,
        abi: erc20Abi,
        functionName: 'approve',
        args: [DEFAULT_MARKET.pool, maxUint256],
      });
      setPendingHash(hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approval failed');
    }
  }

  async function handleSubmit() {
    if (!address) return;
    setError(null);

    // For supply/repay with "max", pass MAX_UINT256 so the Pool pulls the full
    // balance — it handles interest accrual between sign + include.
    const sendAmount =
      useMax && (action === 'supply' || action === 'repay' || action === 'withdraw')
        ? MAX_UINT256
        : amountBig;

    try {
      let hash: `0x${string}`;
      switch (action) {
        case 'supply':
          hash = await writeContractAsync({
            address: DEFAULT_MARKET.pool,
            abi: poolAbi,
            functionName: 'supply',
            args: [reserve.asset, sendAmount, address, 0],
          });
          break;
        case 'withdraw':
          hash = await writeContractAsync({
            address: DEFAULT_MARKET.pool,
            abi: poolAbi,
            functionName: 'withdraw',
            args: [reserve.asset, sendAmount, address],
          });
          break;
        case 'borrow':
          hash = await writeContractAsync({
            address: DEFAULT_MARKET.pool,
            abi: poolAbi,
            functionName: 'borrow',
            args: [
              reserve.asset,
              sendAmount,
              INTEREST_RATE_VARIABLE,
              0,
              address,
            ],
          });
          break;
        case 'repay':
          hash = await writeContractAsync({
            address: DEFAULT_MARKET.pool,
            abi: poolAbi,
            functionName: 'repay',
            args: [
              reserve.asset,
              sendAmount,
              INTEREST_RATE_VARIABLE,
              address,
            ],
          });
          break;
      }
      setPendingHash(hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : `${labels[action]} failed`);
    }
  }

  const label = labels[action];
  const walletBal = (walletBalanceQ.data as bigint | undefined) ?? 0n;

  const hf = (accountData.data as readonly bigint[] | undefined)?.[5] ?? 0n;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl w-full max-w-md p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">
              {label} {reserve.symbol}
            </h3>
            <p className="text-xs text-muted mt-1">Ethereum · Aave V3</p>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-fg text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {isSuccess ? (
          <div className="text-center py-6 space-y-3">
            <div className="text-good text-3xl">✓</div>
            <div className="text-sm">
              {label} confirmed. Position is updating.
            </div>
            <button
              onClick={onClose}
              className="w-full bg-accent/20 border border-accent/40 text-accent rounded-lg py-2 text-sm hover:bg-accent/30"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="stat-label">Amount</label>
                <button
                  onClick={() => {
                    if (maxAmount > 0n) {
                      setAmountStr(formatUnits(maxAmount, reserve.decimals));
                      setUseMax(true);
                    }
                  }}
                  disabled={maxAmount === 0n}
                  className="text-xs text-accent hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  {action === 'borrow'
                    ? ''
                    : `MAX: ${formatUnits(maxAmount, reserve.decimals)}`}
                </button>
              </div>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountStr}
                  onChange={(e) => {
                    const v = e.target.value.replace(/,/g, '.');
                    if (v === '' || /^[0-9]*\.?[0-9]*$/.test(v)) {
                      setAmountStr(v);
                      setUseMax(false);
                    }
                  }}
                  placeholder="0.00"
                  className="w-full bg-bg border border-border rounded-lg px-4 py-3 font-mono text-lg focus:outline-none focus:border-accent/60"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted text-sm">
                  {reserve.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted mt-2">
                <span>
                  Wallet balance:{' '}
                  <span className="font-mono">
                    {formatUnits(walletBal, reserve.decimals)}
                  </span>
                </span>
                {accountData.data && (
                  <span>
                    HF:{' '}
                    <span
                      className={`font-mono ${
                        {
                          good: 'text-good',
                          warn: 'text-warn',
                          bad: 'text-bad',
                          neutral: 'text-muted',
                        }[healthFactorTone(hf)]
                      }`}
                    >
                      {formatHealthFactor(hf)}
                    </span>
                  </span>
                )}
              </div>
            </div>

            {action === 'borrow' && (
              <div className="text-xs text-warn bg-warn/10 border border-warn/30 rounded-lg p-3">
                Borrowing at variable rate ({reserve.symbol}). Keep health factor
                above 1.0 at all times. Aave liquidates below 1.0.
              </div>
            )}
            {action === 'withdraw' && (
              <div className="text-xs text-muted bg-bg border border-border rounded-lg p-3">
                Withdrawing collateral reduces your borrowing power and health
                factor. Tx reverts if HF would drop below 1.0.
              </div>
            )}

            {error && (
              <div className="text-xs text-bad bg-bad/10 border border-bad/30 rounded-lg p-3 break-words max-h-32 overflow-auto">
                {error}
              </div>
            )}

            <div className="space-y-2">
              {needsAllowance(action) && !hasAllowance && amountBig > 0n ? (
                <button
                  onClick={handleApprove}
                  disabled={isSigning || isConfirming}
                  className="w-full bg-accent text-bg font-medium rounded-lg py-3 hover:bg-accent/90 disabled:opacity-50"
                >
                  {isSigning || isConfirming
                    ? 'Approving…'
                    : `Approve ${reserve.symbol}`}
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={
                    isSigning ||
                    isConfirming ||
                    amountBig === 0n ||
                    !address ||
                    (action !== 'borrow' && amountBig > maxAmount && !useMax)
                  }
                  className="w-full bg-accent text-bg font-medium rounded-lg py-3 hover:bg-accent/90 disabled:opacity-50"
                >
                  {isSigning
                    ? 'Sign in wallet…'
                    : isConfirming
                      ? 'Confirming…'
                      : label}
                </button>
              )}
              {pendingHash && (
                <a
                  href={`https://etherscan.io/tx/${pendingHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-muted hover:text-fg text-center"
                >
                  View on Etherscan ↗
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
