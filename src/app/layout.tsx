
import type { Metadata, Viewport } from 'next';
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
  manifest: '/manifest.json',
  icons: {
    apple: "/icon-192x192.png",
  },
};

export const viewport: Viewport = {
  themeColor: '#3F51B5',
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" suppressHydrationWarning>
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
