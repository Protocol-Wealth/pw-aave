import { useReadContract } from 'wagmi';
import type { Address } from 'viem';
import { poolAbi } from '@/lib/abis/pool';
import { DEFAULT_MARKET } from '@/lib/chains';

export type UserAccountData = {
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  healthFactor: bigint;
};

export function useUserAccountData(user: Address | undefined) {
  return useReadContract({
    address: DEFAULT_MARKET.pool,
    abi: poolAbi,
    functionName: 'getUserAccountData',
    args: user ? [user] : undefined,
    query: {
      enabled: Boolean(user),
      refetchInterval: 30_000,
    },
  });
}
