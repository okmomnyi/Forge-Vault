import type { Metadata } from 'next';
import { Oswald, Work_Sans, Space_Mono } from 'next/font/google';
import './globals.css';

const oswald = Oswald({
  subsets: ['latin'],
  variable: '--font-oswald',
  display: 'swap',
});
const workSans = Work_Sans({
  subsets: ['latin'],
  variable: '--font-work-sans',
  display: 'swap',
});
const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-space-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Forge Auto Parts — Mombasa',
    template: '%s | Forge Auto Parts',
  },
  description:
    'Quality new, used and refurbished car spare parts in Mombasa. Browse the catalog and order over WhatsApp.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${oswald.variable} ${workSans.variable} ${spaceMono.variable}`}
    >
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
