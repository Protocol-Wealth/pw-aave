# PW Aave Console

An open-source, read-only Aave V3 console for Ethereum mainnet. Connect a wallet, see your position — health factor, collateral, debt, available borrow — and browse reserve rates. No middle layer, no backend, no tracking. Talks directly to Aave V3 contracts via viem.

Built by [Protocol Wealth](https://protocolwealthllc.com) as defensive infrastructure: if the official Aave UI is ever unreachable during a moment that matters, you still have a working frontend.

> **Not affiliated with Aave.** We are not the Aave Companies, Aave DAO, or any contributor. Aave is a registered trademark of its respective owners. This project is an independent community interface.

---

## Status

**v0.3 — read + single-tx writes + multi-tx leverage/unloop.** The console supports every core operation you'd want on a position:

- `supply`, `withdraw`, `borrow`, `repay` — one tx each (plus one-time `approve`)
- **Leverage (looping)** — `supply → (borrow → swap → supply) × N` via Uniswap V3, best-of-4-fee-tier quoting, per-iteration slippage protection
- **Unloop (deleverage)** — `(withdraw → swap → repay) × N` with debt clamping

No flash loans, no new smart contracts. Every step is a standard transaction the user signs in their wallet. No backend, no custody.

Native ETH is not yet supported; supply/borrow operates on WETH.

## Stack

- Vite + React + TypeScript
- [wagmi v2](https://wagmi.sh) + [viem](https://viem.sh) for EVM reads
- [RainbowKit](https://rainbowkit.com) for wallet connect UX
- Tailwind CSS
- Deployed on Fly.io (`ord` region), static SPA served via nginx

## Aave V3 contracts (Ethereum mainnet)

| Contract | Address |
|----------|---------|
| Pool | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` |
| PoolAddressesProvider | `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e` |
| UiPoolDataProviderV3 | `0x5c5228aC8BC1528482514aF3e27E692495148717` |
| AaveOracle | `0x54586bE62E3c3580375aE3723C145253060Ca0C2` |

Addresses live in [`src/lib/chains.ts`](src/lib/chains.ts). Adding Base, Arbitrum, Polygon, etc. is configuration, not code.

## Local development

```bash
npm install
cp .env.example .env
# edit .env and set VITE_WALLETCONNECT_PROJECT_ID — get one free at https://cloud.reown.com
npm run dev
```

The dev server runs on `http://localhost:5173`.

### Environment variables

| Var | Required | Purpose |
|-----|----------|---------|
| `VITE_WALLETCONNECT_PROJECT_ID` | yes | WalletConnect/RainbowKit project ID |
| `VITE_ALCHEMY_API_KEY` | no | Higher-reliability Ethereum RPC; falls back to a chain of CORS-enabled public RPCs (publicnode, Ankr, Cloudflare) |

## Deploy

```bash
flyctl deploy --remote-only
```

Build-time secrets (required for WalletConnect to work in production):

```bash
flyctl secrets set \
  VITE_WALLETCONNECT_PROJECT_ID=your_project_id \
  VITE_ALCHEMY_API_KEY=your_alchemy_key
flyctl deploy --remote-only
```

Note: Vite inlines `VITE_*` env vars at build time, not runtime. Changing them requires a redeploy.

## Security notes

- **No custody.** The app never holds private keys. Every signature happens in the user's wallet.
- **No backend.** All reads are client-side RPC calls directly to Aave contracts.
- **No analytics, no cookies, no tracking.** The console ships as a static bundle.
- **Write flows are gated.** They ship behind a feature flag after review. If you fork this and enable writes, own the review pass yourself.

## Roadmap

- [x] v0.1 — Read-only position + reserves
- [x] v0.2 — Supply, withdraw, borrow, repay (single-tx each)
- [x] v0.3 — Leverage (looping) and unloop (deleverage), multi-tx via Uniswap V3
- [ ] WETH gateway for native ETH supply/withdraw
- [ ] Permit-based approvals (skip the approve tx where supported)
- [ ] eMode / isolation mode awareness
- [ ] Multi-chain: Base, Arbitrum, Polygon (configuration, not code)
- [ ] Health-factor alerting (webhook out)

## Not financial advice

This tool displays on-chain data. It does not give advice. Verify every transaction in your wallet before signing.

## License

MIT — see [LICENSE](LICENSE).
