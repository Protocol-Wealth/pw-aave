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
  variableDebtTokenAddress: Address;
  ltvBps: number; // loan-to-value in bps (10000 = 100%)
  liquidationThresholdBps: number;
  isActive: boolean;
  isFrozen: boolean;
  borrowEnabled: boolean;
};

// Aave V3 ReserveConfigurationMap bit layout. See:
// https://docs.aave.com/developers/core-contracts/pool#getreservedata
function decodeConfig(data: bigint) {
  const ltv = Number(data & 0xffffn);
  const liqThreshold = Number((data >> 16n) & 0xffffn);
  const isActive = ((data >> 56n) & 1n) === 1n;
  const isFrozen = ((data >> 57n) & 1n) === 1n;
  const borrowEnabled = ((data >> 58n) & 1n) === 1n;
  return { ltv, liqThreshold, isActive, isFrozen, borrowEnabled };
}

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
        configuration: { data: bigint };
        currentLiquidityRate: bigint;
        currentVariableBorrowRate: bigint;
        aTokenAddress: Address;
        variableDebtTokenAddress: Address;
      };

      const cfg = decodeConfig(rd.configuration.data);

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
        variableDebtTokenAddress: rd.variableDebtTokenAddress,
        ltvBps: cfg.ltv,
        liquidationThresholdBps: cfg.liqThreshold,
        isActive: cfg.isActive,
        isFrozen: cfg.isFrozen,
        borrowEnabled: cfg.borrowEnabled,
      });
    }
  }

  return {
    rows,
    isLoading: listQuery.isLoading || batched.isLoading,
    isError: listQuery.isError || batched.isError,
  };
}
