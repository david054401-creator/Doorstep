'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { House, Building2, DollarSign, MessageSquare, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavTab {
  label: string;
  icon: React.ElementType;
  href: string;
  match: string;
}

const tabs: NavTab[] = [
  { label: 'Home',       icon: House,         href: '/dashboard',   match: '/dashboard' },
  { label: 'Properties', icon: Building2,     href: '/properties',  match: '/properties' },
  { label: 'Money',      icon: DollarSign,    href: '/money',       match: '/money' },
  { label: 'Messages',   icon: MessageSquare, href: '/messages',    match: '/messages' },
  { label: 'More',       icon: Menu,          href: '/settings',    match: '/settings' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-50 flex items-stretch"
      style={{
        height: '64px',
        backgroundColor: '#FFFFFF',
        borderTop: '1px solid #E8E3DC',
      }}
    >
      {tabs.map(({ label, icon: Icon, href, match }) => {
        const isActive = pathname === match || pathname.startsWith(match + '/');
        return (
          <Link
            key={href}
            href={href}
            className="flex flex-1 flex-col items-center justify-center gap-0.5"
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon
              size={20}
              style={{
                color: isActive ? '#C75D3D' : '#A8A099',
                transition: 'color 200ms ease',
              }}
              strokeWidth={isActive ? 2.5 : 1.75}
            />
            <span
              className="text-tiny font-medium leading-none"
              style={{
                fontSize: '12px',
                color: isActive ? '#C75D3D' : '#A8A099',
                transition: 'color 200ms ease',
              }}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
