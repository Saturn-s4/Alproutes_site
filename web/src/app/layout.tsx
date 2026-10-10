import type { Metadata } from 'next';
import { IBM_Plex_Sans, JetBrains_Mono, Unbounded } from 'next/font/google';
import type { ReactNode } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';
import { Header } from '@/components/Header';
import { PrefsProvider } from '@/components/Prefs';
import { getPrefs } from '@/lib/prefs-server';

const display = Unbounded({ subsets: ['latin', 'cyrillic'], weight: ['500', '700'], variable: '--font-unbounded' });
const body = IBM_Plex_Sans({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600'], variable: '--font-plex' });
const mono = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], weight: ['400', '500'], variable: '--font-jetbrains' });

export const metadata: Metadata = {
  title: { default: 'Alproutes', template: '%s · Alproutes' },
  description: 'Каталог альпинистских маршрутов: карта, описания, категории, треки.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { lang, theme } = await getPrefs();
  return (
    <html
      lang={lang}
      data-theme={theme === 'system' ? undefined : theme}
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body>
        <PrefsProvider lang={lang} theme={theme}>
          <div className="app">
            <Header />
            {children}
          </div>
        </PrefsProvider>
      </body>
    </html>
  );
}
