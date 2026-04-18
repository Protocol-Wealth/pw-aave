import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { mainnet } from 'wagmi/chains';
import { http } from 'wagmi';

const WALLETCONNECT_PROJECT_ID =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '';

const ALCHEMY_KEY = import.meta.env.VITE_ALCHEMY_API_KEY;

const mainnetTransport = ALCHEMY_KEY
  ? http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`)
  : http();

export const wagmiConfig = getDefaultConfig({
  appName: 'PW Aave Console',
  projectId: WALLETCONNECT_PROJECT_ID || 'pw-aave-dev',
  chains: [mainnet],
  transports: {
    [mainnet.id]: mainnetTransport,
  },
  ssr: false,
});

export const WRITES_ENABLED = import.meta.env.VITE_ENABLE_WRITES === 'true';
