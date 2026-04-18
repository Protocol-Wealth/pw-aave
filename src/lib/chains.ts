import type { Address } from 'viem';

export type AaveV3Market = {
  chainId: number;
  name: string;
  pool: Address;
  poolAddressesProvider: Address;
  uiPoolDataProvider: Address;
  aaveOracle: Address;
};

export const ETHEREUM_MAINNET: AaveV3Market = {
  chainId: 1,
  name: 'Ethereum',
  pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  poolAddressesProvider: '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e',
  uiPoolDataProvider: '0x5c5228aC8BC1528482514aF3e27E692495148717',
  aaveOracle: '0x54586bE62E3c3580375aE3723C145253060Ca0C2',
};

export const MARKETS: Record<number, AaveV3Market> = {
  [ETHEREUM_MAINNET.chainId]: ETHEREUM_MAINNET,
};

export const DEFAULT_MARKET = ETHEREUM_MAINNET;
