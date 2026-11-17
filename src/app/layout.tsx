import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Cylinder Ops · Agency management', description: 'LPG booking, inventory and delivery operations' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
