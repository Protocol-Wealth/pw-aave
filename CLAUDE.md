# CLAUDE.md — pw-aave

> Open-source Aave V3 console. Ethereum mainnet. **Not affiliated with Aave — this is a community interface.**

## Quick orientation

| | |
|---|---|
| Live | https://pw-aave.fly.dev/ |
| Repo | [Protocol-Wealth/pw-aave](https://github.com/Protocol-Wealth/pw-aave) (public, MIT) |
| Fly app | `pw-aave` in `ord` region, nginx-alpine serving Vite static dist |
| Stack | Vite + React + TypeScript, wagmi v2 + viem, RainbowKit, Tailwind |

## Commands

```bash
npm install
npm run dev            # dev server on :5173
npm run typecheck      # tsc -b --noEmit
npm run build          # tsc -b && vite build → dist/
flyctl deploy --remote-only --ha=false
```

Build-time env (Vite inlines at build, not runtime — redeploy to change):

- `VITE_WALLETCONNECT_PROJECT_ID` — get one at https://cloud.reown.com
- `VITE_ALCHEMY_API_KEY` — optional, falls back to public RPC chain

## Core invariants — do not regress without asking

1. **No new smart contracts.** We interact only with canonical Aave V3 + Uniswap V3. Flash-loan looping requires a receiver contract implementing `executeOperation` — we explicitly chose multi-tx instead. If asked to add flash-loan flows, suggest integrating a third-party audited looper (DeFi Saver, Instadapp DSA), **not** deploying a PW contract.

2. **Non-custodial, no backend.** Pure static SPA. Reads go directly to public Ethereum RPCs from the browser. No server state, no tracking, no analytics. Don't introduce a backend without a very specific reason.

3. **Public access — no auth, no gating.** Anyone can connect a wallet and use this. No PW-specific integration, no advisor-only tabs, no client-ID routing. If PW wants client-specific Aave tooling, that belongs in pw-portal or pw-os, not here.

4. **Not affiliated with Aave.** Every surface (README, footer, meta tags) must include this disclaimer. Aave is a trademark of its respective owners. This repo is a community interface — treat trademark usage accordingly.

## RPC strategy

Default transport is a `fallback` chain of CORS-enabled public RPCs: **publicnode → Ankr → Cloudflare**. Do **not** revert to viem's default `http()` with no URL — that resolves to `eth.merkle.io`, which rejects browser preflight requests and breaks every contract read. This bit the project on day 1; the fix is documented in `src/lib/wagmi.ts`.

`VITE_ALCHEMY_API_KEY` prepends an Alchemy transport to the fallback chain for production reliability.

## Architecture

```
src/
├── lib/
│   ├── wagmi.ts          # wagmi config + RPC fallback chain
│   ├── chains.ts         # Aave V3 contract addresses per chain
│   ├── format.ts         # ray → APY, base-currency → USD, HF formatting
│   └── abis/
│       ├── pool.ts       # Aave Pool: getUserAccountData, supply, withdraw, borrow, repay, getReserveData
│       ├── erc20.ts      # balanceOf, allowance, approve, symbol, decimals
│       ├── oracle.ts     # AaveOracle.getAssetPrice (used in loop execution)
│       └── uniswap.ts    # SwapRouter02 + QuoterV2 + fee tier constants
├── hooks/                # wagmi-based read hooks (all refetchInterval-driven)
├── components/
│   ├── Header.tsx            # RainbowKit ConnectButton
│   ├── PositionSummary.tsx   # getUserAccountData display
│   ├── ReservesTable.tsx     # reserves + per-reserve Supply/Borrow/Withdraw/Repay
│   ├── ActionModal.tsx       # single-tx flows (supply/withdraw/borrow/repay)
│   ├── LoopWizard.tsx        # multi-tx leverage
│   └── UnloopWizard.tsx      # multi-tx deleverage
└── App.tsx
```

## Write flow patterns

- **Single-tx actions** (supply/withdraw/borrow/repay) live in `ActionModal.tsx`. Approval handled via `maxUint256` to minimize re-approves. `MAX_UINT256` sentinel used for supply/withdraw/repay "max" so interest accrual between sign-and-include doesn't leave dust.

- **Multi-tx orchestration** (leverage, unloop) lives in the Wizards. Each iteration re-reads on-chain state (`getUserAccountData`, balances, debt) so drift during the sequence doesn't break subsequent steps. Swaps always bound by `amountOutMinimum` from the user's slippage tolerance.

- **Best-fee-tier selection** for Uniswap swaps: inline `bestFeeTier` helper loops through all 4 tiers (100/500/3000/10000) calling `quoteExactInputSingle`, returns the highest-output pool. Silent-catches reverts (pools with no liquidity at that tier).

## Gotchas

- **Native ETH not supported.** Wrap to WETH first. Future: `WrappedTokenGateway` integration.
- **Repay over-shoot.** When the swap output exceeds remaining debt, we clamp to `min(walletBalance, onchainDebt)` via a read before the repay tx — otherwise Aave reverts with "No debt of selected type".
- **QuoterV2 is technically nonpayable** but always invoked via `eth_call`. ABI declares it as `stateMutability: 'view'` so wagmi's `useReadContract` / `publicClient.readContract` can hit it. This is safe and matches the pattern every Uniswap frontend uses.
- **Bundle is ~260KB gzipped**, dominated by RainbowKit connectors for every supported wallet. Can slim with `manualChunks` or a trimmed wallet list if needed.

## Roadmap

See README.md — v0.3 is current, next candidates are the WETH gateway and EIP-2612 permit to cut the approve-tx count.
