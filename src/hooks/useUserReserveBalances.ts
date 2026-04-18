import { useReadContracts } from 'wagmi';
import type { Address } from 'viem';
import { erc20Abi } from '@/lib/abis/erc20';
import type { ReserveRow } from './useReserves';

export type UserReserveBalance = {
  asset: Address;
  supplied: bigint;
  variableDebt: bigint;
};

export function useUserReserveBalances(
  reserves: ReserveRow[],
  user: Address | undefined,
) {
  const contracts = user
    ? reserves.flatMap((r) => [
        {
          address: r.aTokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf' as const,
          args: [user] as const,
        },
        {
          address: r.variableDebtTokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf' as const,
          args: [user] as const,
        },
      ])
    : [];

  const batched = useReadContracts({
    contracts,
    query: {
      enabled: Boolean(user) && reserves.length > 0,
      refetchInterval: 30_000,
    },
  });

  const balancesByAsset = new Map<Address, UserReserveBalance>();
  if (batched.data && user) {
    for (let i = 0; i < reserves.length; i++) {
      const supplied = batched.data[i * 2];
      const debt = batched.data[i * 2 + 1];
      balancesByAsset.set(reserves[i].asset, {
        asset: reserves[i].asset,
        supplied:
          supplied?.status === 'success' ? (supplied.result as bigint) : 0n,
        variableDebt:
          debt?.status === 'success' ? (debt.result as bigint) : 0n,
      });
    }
  }

  return {
    balancesByAsset,
    isLoading: batched.isLoading,
    refetch: batched.refetch,
  };
}
