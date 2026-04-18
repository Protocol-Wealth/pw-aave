import { useReadContract } from 'wagmi';
import type { Address } from 'viem';
import { erc20Abi } from '@/lib/abis/erc20';

export function useTokenBalance(token: Address | undefined, account: Address | undefined) {
  return useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: account ? [account] : undefined,
    query: {
      enabled: Boolean(token && account),
      refetchInterval: 30_000,
    },
  });
}

export function useTokenAllowance(
  token: Address | undefined,
  owner: Address | undefined,
  spender: Address | undefined,
) {
  return useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: owner && spender ? [owner, spender] : undefined,
    query: {
      enabled: Boolean(token && owner && spender),
      refetchInterval: 15_000,
    },
  });
}
