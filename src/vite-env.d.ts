/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WALLETCONNECT_PROJECT_ID: string;
  readonly VITE_ALCHEMY_API_KEY?: string;
  readonly VITE_ENABLE_WRITES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
