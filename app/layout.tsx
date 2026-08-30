import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://champagne-mastering.vossx.chatgpt.site'),
  title: 'Champagne — Agentic Music Mastering',
  description:
    'AI guides the physics behind Champagne’s mastering engine. Compare original and mastered versions, then download your finished product.',
  icons: {
    icon: '/favicon-64.png',
    apple: '/champagne-icon.png',
  },
  openGraph: {
    title: 'Champagne — Agentic Music Mastering',
    description:
      'AI directs. Champagne masters. Hear every revision and keep your audio on your device.',
    type: 'website',
    images: [{ url: '/og.png', width: 1672, height: 941, alt: 'Champagne AI-directed mastering studio' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Champagne — Agentic Music Mastering',
    description: 'AI directs. Champagne masters. Your audio stays on your device.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
