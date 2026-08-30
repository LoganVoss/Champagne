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
  title: 'Champagne — AI-directed mastering studio',
  description:
    'Direct a professional mastering engine in plain language. Hear every revision, compare versions, and export a release-ready WAV locally.',
  icons: {
    icon: '/favicon-64.png',
    apple: '/champagne-icon.png',
  },
  openGraph: {
    title: 'Champagne — AI-directed mastering studio',
    description:
      'AI directs. Champagne masters. Hear every revision and keep your audio on your device.',
    type: 'website',
    images: [{ url: '/og.png', width: 1672, height: 941, alt: 'Champagne AI-directed mastering studio' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Champagne — AI-directed mastering studio',
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
