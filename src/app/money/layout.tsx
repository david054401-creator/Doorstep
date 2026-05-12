import { AppShell } from '@/components/layout/app-shell';

export default function MoneyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
