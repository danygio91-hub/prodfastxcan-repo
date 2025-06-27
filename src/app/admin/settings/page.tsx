import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Settings, Construction } from 'lucide-react';

export default function AdminSettingsPage() {
  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8">
            <AdminNavMenu />

            <header className="space-y-2">
                <h1 className="text-3xl font-bold font-headline tracking-tight">Configurazione App</h1>
                <p className="text-muted-foreground">
                Impostazioni generali dell'applicazione.
                </p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle>Pagina in Costruzione</CardTitle>
                    <CardDescription>Questa sezione è attualmente in fase di sviluppo.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                    <Construction className="h-16 w-16 text-muted-foreground mb-4" />
                    <p className="text-lg font-semibold text-muted-foreground">Torneremo presto!</p>
                </CardContent>
            </Card>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
