import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Settings, Brush } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { ThemeToggler } from '@/components/ThemeToggler';
import { Label } from '@/components/ui/label';


export default function AdminAppSettingsPage() {
  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8">
            <AdminNavMenu />

            <header className="space-y-2">
                <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                    <Settings className="h-8 w-8 text-primary" />
                    Gestione App
                </h1>
                <p className="text-muted-foreground">
                    Personalizzazione dell'aspetto e del tema dell'applicazione.
                </p>
            </header>
            
            <Card>
                <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                        <Brush className="h-6 w-6 text-primary" />
                        Personalizzazione Tema
                    </CardTitle>
                    <CardDescription>
                        Scegli il tema dell'applicazione. Puoi cambiarlo in qualsiasi momento usando il pulsante in basso a destra.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div>
                            <Label>Tema Attuale</Label>
                            <p className="text-sm text-muted-foreground">
                            L'applicazione supporta un tema chiaro e uno scuro. Usa il selettore per cambiare l'aspetto.
                            </p>
                            <div className="mt-4">
                            <ThemeToggler />
                            </div>
                    </div>
                    <Separator />
                    <div>
                        <Label>Anteprima Colori Principali</Label>
                        <div className="flex space-x-4 mt-2">
                            <div className="flex flex-col items-center">
                                <div className="w-10 h-10 rounded-full bg-primary border-2 border-border"></div>
                                <span className="text-xs mt-1">Primary</span>
                            </div>
                                <div className="flex flex-col items-center">
                                <div className="w-10 h-10 rounded-full bg-secondary border-2 border-border"></div>
                                <span className="text-xs mt-1">Secondary</span>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="w-10 h-10 rounded-full bg-accent border-2 border-border"></div>
                                <span className="text-xs mt-1">Accent</span>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="w-10 h-10 rounded-full bg-destructive border-2 border-border"></div>
                                <span className="text-xs mt-1">Destructive</span>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
