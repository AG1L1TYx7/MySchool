import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { AuthProvider } from '@/lib/auth';
import { I18nProvider } from '@/lib/i18n';
import './globals.css';

// Local font so builds never depend on network access (offline-first, docs/08).
const geist = localFont({ src: './fonts/GeistVF.woff', variable: '--font-geist', weight: '100 900', display: 'optional', preload: true });

export const metadata: Metadata = {
  title: { default: 'SmartSchool', template: '%s · SmartSchool' },
  description: 'AI-native learning platform for K-12 schools',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The language attribute is updated by I18nProvider once the viewer's language is known.
    <html lang="en">
      <body className={geist.className}>
        <AuthProvider>
          <I18nProvider>{children}</I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
