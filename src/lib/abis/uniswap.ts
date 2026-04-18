import type { Address } from 'viem';

// Ethereum mainnet
export const UNISWAP_V3_SWAP_ROUTER_02: Address =
  '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
export const UNISWAP_V3_QUOTER_V2: Address =
  '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';

// Fee tiers (hundredths of a bip). 100 = 0.01%, 500 = 0.05%, 3000 = 0.30%, 10000 = 1.00%.
export const UNISWAP_FEE_TIERS = [100, 500, 3000, 10000] as const;
export type UniswapFee = (typeof UNISWAP_FEE_TIERS)[number];

// QuoterV2 is technically nonpayable but is always invoked via eth_call —
// declaring view here is safe and lets wagmi's useReadContract hit it.
export const quoterV2Abi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'view',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

export const swapRouter02Abi = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;
