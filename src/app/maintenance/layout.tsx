import { AppShell } from '@/components/layout/app-shell';

export default function MaintenanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
