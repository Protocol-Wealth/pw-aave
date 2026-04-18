import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Header } from '@/components/Header';
import { PositionSummary } from '@/components/PositionSummary';
import { ReservesTable } from '@/components/ReservesTable';
import { LoopWizard } from '@/components/LoopWizard';
import { UnloopWizard } from '@/components/UnloopWizard';

export function App() {
  const { isConnected } = useAccount();
  const [openWizard, setOpenWizard] = useState<'loop' | 'unloop' | null>(null);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 space-y-8">
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs text-muted uppercase tracking-wider">
              Your Position
            </h2>
            {isConnected && (
              <div className="flex gap-2">
                <button
                  onClick={() => setOpenWizard('loop')}
                  className="text-xs border border-border hover:border-accent/60 hover:text-accent rounded-lg px-3 py-1.5 transition-colors"
                >
                  Leverage ↑
                </button>
                <button
                  onClick={() => setOpenWizard('unloop')}
                  className="text-xs border border-border hover:border-accent/60 hover:text-accent rounded-lg px-3 py-1.5 transition-colors"
                >
                  Unloop ↓
                </button>
              </div>
            )}
          </div>
          <PositionSummary />
        </section>
        <section>
          <ReservesTable />
        </section>
      </main>
      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-muted flex flex-wrap gap-x-6 gap-y-2 items-center justify-between">
          <span>
            Open-source Aave V3 console · built by{' '}
            <a
              href="https://protocolwealthllc.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-fg"
            >
              Protocol Wealth
            </a>
          </span>
          <span>
            <a
              href="https://github.com/Protocol-Wealth/pw-aave"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-fg"
            >
              GitHub
            </a>
            {' · '}
            Not affiliated with Aave. Not financial advice.
          </span>
        </div>
      </footer>

      {openWizard === 'loop' && (
        <LoopWizard onClose={() => setOpenWizard(null)} />
      )}
      {openWizard === 'unloop' && (
        <UnloopWizard onClose={() => setOpenWizard(null)} />
      )}
    </div>
  );
}
