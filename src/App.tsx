import { Header } from '@/components/Header';
import { PositionSummary } from '@/components/PositionSummary';
import { ReservesTable } from '@/components/ReservesTable';

export function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 space-y-8">
        <section>
          <h2 className="text-xs text-muted uppercase tracking-wider mb-3">
            Your Position
          </h2>
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
            Not affiliated with Aave. Read-only. Not financial advice.
          </span>
        </div>
      </footer>
    </div>
  );
}
