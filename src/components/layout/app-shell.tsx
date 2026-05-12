'use client';

import { TopBar } from '@/components/layout/top-bar';
import { BottomNav } from '@/components/layout/bottom-nav';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: '#F5F1EA' }}
    >
      <TopBar />

      {/* Main content area */}
      <main
        className="mx-auto w-full max-w-3xl"
        style={{
          /* pb-20 (80px) so content clears the 64px bottom nav with some breathing room */
          paddingBottom: '80px',
        }}
      >
        {children}
      </main>

      <BottomNav />
    </div>
  );
}
