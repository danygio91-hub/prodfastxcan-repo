
"use client";

import React from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { ListChecks, Briefcase, BarChart3, Settings, Building2, Boxes, ShieldAlert, Timer, Combine, ClipboardList, Warehouse, Package, Upload, Truck, CalendarDays, Loader2, Bell, Activity, Calculator } from 'lucide-react';
import DashboardItem from '@/components/dashboard/DashboardItem';
import { checkAttendanceDeclared } from '../attendance-calendar/actions';
import { DailyAttendanceModal } from '@/components/dashboard/DailyAttendanceModal';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

const navItems = [
  { href: '/admin/mrp-simulation', label: 'Simulatore MRP e Bozze', description: 'Simula i fabbisogni e salva le bozze per la produzione.', icon: Calculator },
  { href: '/admin/data-management', label: 'Gestione Dati Commesse', description: 'Importa, visualizza e gestisci le commesse.', icon: ListChecks },
  { href: '/admin/raw-material-management', label: 'Gestione Materie Prime', description: 'Gestisci l\'anagrafica e gli impegni delle materie prime.', icon: Boxes },
  { href: '/admin/reorder-alerts', label: 'Alert Riordino Scorte', description: 'Visualizza i suggerimenti di ordine basati sulla produzione.', icon: Bell },
  { href: '/admin/purchase-orders', label: 'Ordini Fornitore', description: 'Monitora gli ordini di materiale in arrivo dai fornitori.', icon: Truck },
  { href: '/admin/material-import', label: 'Carico/Scarico da File', description: 'Importa massivamente carichi o scarichi di materiale da un file Excel.', icon: Upload },
  { href: '/admin/batch-management', label: 'Gestione Lotti', description: 'Visualizza e gestisci i lotti delle materie prime.', icon: Package },
  { href: '/admin/article-management', label: 'Anagrafica Articoli', description: 'Crea e gestisci la distinta base degli articoli.', icon: ClipboardList },
  { href: '/admin/production-console', label: 'Console Produzione', description: 'Monitora le commesse in produzione.', icon: Briefcase },
  { href: '/admin/attendance-calendar', label: 'Calendario Presenze', description: 'Gestisci ferie, permessi, mutua e fermi macchina.', icon: CalendarDays },
  { href: '/admin/resource-planning', label: 'Foglio Pianificazione Risorse', description: 'Bilancia la capacità dei reparti e gestisci i prestiti operatori.', icon: Activity },
  { href: '/admin/work-group-management', label: 'Gruppi Commesse', description: 'Visualizza e gestisci i gruppi di commesse concatenate.', icon: Combine },
  { href: '/admin/inventory-management', label: 'Inventari', description: 'Visualizza e approva le registrazioni di inventario.', icon: Warehouse },
  { href: '/admin/reports', label: 'Report Produzione', description: 'Genera e visualizza i report di lavorazione.', icon: BarChart3 },
  { href: '/admin/production-time-analysis', label: 'Analisi Tempi Articolo', description: 'Analizza i tempi medi di produzione per articolo.', icon: Timer },
  { href: '/admin/non-conformity-reports', label: 'Report Non Conformità', description: 'Gestisci le segnalazioni di non conformità.', icon: ShieldAlert },
  { href: '/admin/settings', label: 'Configurazione Azienda', description: 'Gestisci operatori, reparti, fasi e postazioni.', icon: Building2 },
  { href: '/admin/app-settings', label: 'Gestione App', description: 'Personalizza il tema e l\'aspetto dell\'applicazione.', icon: Settings },
];

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isDeclared, setIsDeclared] = React.useState<boolean | null>(null);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const today = format(new Date(), 'yyyy-MM-dd');

  React.useEffect(() => {
    checkAttendanceDeclared(today).then(setIsDeclared);
  }, [today]);

  const onDeclared = () => {
    setIsDeclared(true);
    toast({ title: "Presenze dichiarate", description: "Il calendario è ora aggiornato per oggi." });
  };

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight">Dashboard Amministrazione</h1>
            <p className="text-muted-foreground">
              Seleziona un'opzione qui sotto o usa il menu rapido in alto per iniziare.
            </p>
          </header>

          {isDeclared === false && (
            <Alert className="bg-amber-50 border-amber-200 text-amber-800 shadow-sm animate-pulse">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              <div className="flex-1 ml-3">
                <AlertTitle className="font-bold text-amber-900">Dichiarazione Presenze Mancante</AlertTitle>
                <AlertDescription className="text-amber-800">
                  Le presenze per oggi non sono ancora state confermate. Dichiarale ora per aggiornare la capacità del Gantt.
                </AlertDescription>
              </div>
              <div className="flex gap-2 ml-4">
                <Button variant="outline" size="sm" asChild className="border-amber-300 hover:bg-amber-100">
                  <Link href="/admin/attendance-calendar">Apri Calendario</Link>
                </Button>
                <Button size="sm" onClick={() => setIsModalOpen(true)} className="bg-amber-600 hover:bg-amber-700 text-white border-0">
                   Compila Foglio Presenze
                </Button>
              </div>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {navItems.map((item) => (
               <DashboardItem
                key={item.href}
                href={item.href}
                title={item.label}
                description={item.description}
                icon={item.icon}
              />
            ))}
          </div>
        </div>
        {user && (
          <DailyAttendanceModal 
            isOpen={isModalOpen} 
            onOpenChange={setIsModalOpen} 
            uid={user.uid} 
            onDeclared={onDeclared} 
          />
        )}
      </AppShell>
    </AdminAuthGuard>
  );
}
