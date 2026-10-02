import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { AuthProvider } from '@/lib/auth';
import './globals.css';

// Local font so builds never depend on network access (offline-first, docs/08).
const geist = localFont({ src: './fonts/GeistVF.woff', variable: '--font-geist', weight: '100 900', display: 'swap', preload: true });

export const metadata: Metadata = {
  title: { default: 'SmartSchool', template: '%s · SmartSchool' },
  description: 'AI-native learning platform for K-12 schools',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={geist.className}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
