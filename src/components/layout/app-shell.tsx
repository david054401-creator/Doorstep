'use client';

import { TopBar } from '@/components/layout/top-bar';
import { BottomNav } from '@/components/layout/bottom-nav';

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
}

export function AppShell({ children, title }: AppShellProps) {
  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: '#F5F1EA' }}
    >
      <TopBar />

      {title && (
        <div style={{ padding: '16px 16px 0', maxWidth: 768, margin: '0 auto' }}>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 500, color: '#1A1714', margin: 0 }}>{title}</h1>
        </div>
      )}

      {/* Main content area */}
      <main
        className="mx-auto w-full max-w-3xl"
        style={{ paddingBottom: '80px' }}
      >
        {children}
      </main>

      <BottomNav />
    </div>
  );
}
