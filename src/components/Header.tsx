import { ConnectButton } from '@rainbow-me/rainbowkit';

export function Header() {
  return (
    <header className="border-b border-border">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center">
            <span className="text-accent font-mono text-sm font-bold">PW</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">
              Aave Console
            </h1>
            <p className="text-xs text-muted">
              Ethereum mainnet · V3 · read-only
            </p>
          </div>
        </div>
        <ConnectButton
          accountStatus={{
            smallScreen: 'avatar',
            largeScreen: 'full',
          }}
          chainStatus="icon"
          showBalance={false}
        />
      </div>
    </header>
  );
}
