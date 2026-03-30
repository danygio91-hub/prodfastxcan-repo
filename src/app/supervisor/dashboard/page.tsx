
"use client";

import React from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { 
  Briefcase, 
  Activity, 
  CalendarDays, 
  LayoutGrid, 
  ShieldAlert, 
  ArrowRightLeft,
  ChevronRight,
  ClipboardList,
  Combine,
  ListChecks,
  Boxes
} from 'lucide-react';
import DashboardItem from '@/components/dashboard/DashboardItem';
import { checkAttendanceDeclared } from '../../admin/attendance-calendar/actions';
import { DailyAttendanceModal } from '@/components/dashboard/DailyAttendanceModal';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

const supervisorNavItems = [
  { href: '/admin/resource-planning', label: 'Power-Planning Hub', description: 'Bilancia la capacità dei reparti e gestisci i prestiti operatori.', icon: Activity, color: 'text-blue-600' },
  { href: '/admin/attendance-calendar', label: 'Calendario Presenze', description: 'Gestisci ferie, permessi, mutua e presenze giornaliere.', icon: CalendarDays, color: 'text-emerald-600' },
  { href: '/admin/data-management', label: 'Gestione ODL', description: 'Visualizza e ricerca gli ordini di lavoro attivi.', icon: ListChecks, color: 'text-indigo-600' },
];

export default function SupervisorDashboardPage() {
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
    toast({ title: "Presenze dichiarate", description: "Il calendario è ora aggiornato per tutta l'azienda." });
  };

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8 pb-20">
          <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="bg-primary/10 text-primary text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">Ruolo: Supervisor</span>
                <h1 className="text-3xl font-black font-headline tracking-tighter uppercase italic text-slate-800">Control Panel</h1>
              </div>
              <p className="text-muted-foreground font-bold text-xs uppercase tracking-tight opacity-70">
                Punto di accesso unico per la gestione risorse e officina.
              </p>
            </div>

          </header>

          {/* Conditional Attendance Alert (Shared Global Flag) */}
          {isDeclared === false && (
            <Alert className="bg-amber-50 border-2 border-amber-200 text-amber-800 shadow-lg rounded-2xl p-6 relative overflow-hidden animate-in slide-in-from-top-4">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <CalendarDays className="h-24 w-24" />
              </div>
              <div className="flex items-start gap-4 relative z-10">
                <div className="bg-amber-100 p-3 rounded-xl border border-amber-200">
                    <ShieldAlert className="h-6 w-6 text-amber-600" />
                </div>
                <div className="flex-1">
                  <AlertTitle className="font-black text-xl text-amber-900 uppercase tracking-tighter">Dichiarazione Presenze Mancante</AlertTitle>
                  <AlertDescription className="text-amber-800 font-bold text-sm mt-1">
                    Il foglio presenze di oggi non è ancora stato compilato. Questa azione è necessaria per calcolare correttamente i tempi di consegna nel Power-Planning.
                  </AlertDescription>
                  <div className="flex gap-3 mt-6">
                    <Button onClick={() => setIsModalOpen(true)} className="bg-amber-600 hover:bg-amber-700 text-white border-0 font-black uppercase text-xs h-10 px-6 rounded-xl shadow-md">
                       Compila Ora
                    </Button>
                    <Button variant="outline" size="sm" asChild className="border-amber-300 hover:bg-amber-100 font-black uppercase text-[10px] h-10 rounded-xl">
                      <Link href="/admin/attendance-calendar">Apri Calendario Dettagliato</Link>
                    </Button>
                  </div>
                </div>
              </div>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {supervisorNavItems.map((item) => (
               <DashboardItem
                key={item.href}
                href={item.href}
                title={item.label}
                description={item.description}
                icon={item.icon}
              />
            ))}
          </div>

          <div className="bg-slate-50 p-8 rounded-3xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-center space-y-4">
             <div className="p-4 bg-white rounded-full shadow-sm">
                <Activity className="h-10 w-10 text-slate-400" />
             </div>
             <div>
                <h3 className="font-black text-lg text-slate-700 uppercase tracking-tight">Accesso Coordinatore</h3>
                <p className="text-sm text-muted-foreground font-medium max-w-md">
                    In qualità di Supervisor, hai accesso alla visione d'insieme dell'azienda e puoi reindirizzare le risorse dove necessario. I tuoi permessi sono validi sia in amministrazione che in produzione.
                </p>
             </div>
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
