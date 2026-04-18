import { useReadContract, useReadContracts } from 'wagmi';
import type { Address } from 'viem';
import { poolAbi } from '@/lib/abis/pool';
import { erc20Abi } from '@/lib/abis/erc20';
import { DEFAULT_MARKET } from '@/lib/chains';

export type ReserveRow = {
  asset: Address;
  symbol: string;
  decimals: number;
  supplyApyRay: bigint;
  borrowApyRay: bigint;
  aTokenAddress: Address;
};

export function useReserves() {
  const listQuery = useReadContract({
    address: DEFAULT_MARKET.pool,
    abi: poolAbi,
    functionName: 'getReservesList',
    query: {
      staleTime: 60_000,
    },
  });

  const assets = (listQuery.data ?? []) as Address[];

  const reserveDataContracts = assets.flatMap((asset) => [
    {
      address: DEFAULT_MARKET.pool,
      abi: poolAbi,
      functionName: 'getReserveData' as const,
      args: [asset] as const,
    },
    {
      address: asset,
      abi: erc20Abi,
      functionName: 'symbol' as const,
    },
    {
      address: asset,
      abi: erc20Abi,
      functionName: 'decimals' as const,
    },
  ]);

  const batched = useReadContracts({
    contracts: reserveDataContracts,
    query: {
      enabled: assets.length > 0,
      refetchInterval: 60_000,
    },
  });

  const rows: ReserveRow[] = [];
  if (batched.data && assets.length > 0) {
    for (let i = 0; i < assets.length; i++) {
      const reserveResult = batched.data[i * 3];
      const symbolResult = batched.data[i * 3 + 1];
      const decimalsResult = batched.data[i * 3 + 2];

      if (reserveResult?.status !== 'success') continue;

      const rd = reserveResult.result as {
        currentLiquidityRate: bigint;
        currentVariableBorrowRate: bigint;
        aTokenAddress: Address;
      };

      rows.push({
        asset: assets[i],
        symbol:
          symbolResult?.status === 'success'
            ? (symbolResult.result as string)
            : assets[i].slice(0, 6),
        decimals:
          decimalsResult?.status === 'success'
            ? Number(decimalsResult.result)
            : 18,
        supplyApyRay: rd.currentLiquidityRate,
        borrowApyRay: rd.currentVariableBorrowRate,
        aTokenAddress: rd.aTokenAddress,
      });
    }
  }

  return {
    rows,
    isLoading: listQuery.isLoading || batched.isLoading,
    isError: listQuery.isError || batched.isError,
  };
}
