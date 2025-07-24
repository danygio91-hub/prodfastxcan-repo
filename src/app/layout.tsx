
import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from '@/components/layout/ThemeProvider';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { ActiveJobProvider } from '@/contexts/ActiveJobProvider';
import { ActiveMaterialSessionProvider } from '@/contexts/ActiveMaterialSessionProvider';
import { PT_Sans } from 'next/font/google';
import { cn } from '@/lib/utils';

const ptSans = PT_Sans({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-pt-sans',
});

export const metadata: Metadata = {
  title: 'ProdFast Xcan',
  description: 'Applicazione per il Tracciamento dei Tempi di Produzione',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#220_10%_10%" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#25_25%_95%" media="(prefers-color-scheme: light)" />
      </head>
      <body className={cn("font-body antialiased", ptSans.variable)}>
        <AuthProvider>
          <ActiveJobProvider>
            <ActiveMaterialSessionProvider>
              <ThemeProvider
                attribute="class"
                defaultTheme="dark"
                enableSystem={false}
                disableTransitionOnChange
              >
                {children}
                <Toaster />
              </ThemeProvider>
            </ActiveMaterialSessionProvider>
          </ActiveJobProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
