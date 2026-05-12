import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { QueryProvider, ToastProvider } from '@/lib/providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Doorstep — Rental Management Made Simple',
    template: '%s | Doorstep',
  },
  description:
    'Manage your rental properties with ease. Track rent, tenants, maintenance, and finances all in one place.',
  applicationName: 'Doorstep',
  keywords: ['rental management', 'landlord app', 'property management', 'rent tracking'],
  authors: [{ name: 'Doorstep' }],
  robots: 'index, follow',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'Doorstep',
    title: 'Doorstep — Rental Management Made Simple',
    description: 'Manage your rental properties with ease.',
  },
  icons: {
    icon: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#F5F1EA',
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="font-body h-full min-h-screen"
        style={{ backgroundColor: '#F5F1EA', color: '#1A1714' }}
      >
        <QueryProvider>
          <ToastProvider>{children}</ToastProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
