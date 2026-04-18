import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { mainnet } from 'wagmi/chains';
import { http, fallback } from 'wagmi';
import type { Transport } from 'viem';

const WALLETCONNECT_PROJECT_ID =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '';

const ALCHEMY_KEY = import.meta.env.VITE_ALCHEMY_API_KEY;

// CORS-enabled public RPCs. viem's default transport uses eth.merkle.io which
// rejects browser preflight requests — that's why reads silently fail.
const publicEndpoints = [
  'https://ethereum-rpc.publicnode.com',
  'https://rpc.ankr.com/eth',
  'https://cloudflare-eth.com',
];

const transports: Transport[] = [];
if (ALCHEMY_KEY) {
  transports.push(http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`));
}
for (const url of publicEndpoints) {
  transports.push(http(url));
}

export const wagmiConfig = getDefaultConfig({
  appName: 'PW Aave Console',
  projectId: WALLETCONNECT_PROJECT_ID || 'pw-aave-dev',
  chains: [mainnet],
  transports: {
    [mainnet.id]: fallback(transports, { rank: false }),
  },
  ssr: false,
});

export const WRITES_ENABLED = import.meta.env.VITE_ENABLE_WRITES === 'true';
