
"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { LayoutDashboard, Users, ScanLine, AlertTriangle, Clock, Boxes } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/components/auth/AuthProvider';

export default function OperatorNavMenu() {
  const pathname = usePathname();
  const { toast } = useToast();
  const { operator } = useAuth();

  const handleClockIn = React.useCallback(() => {
    toast({
      title: "Timbratura Registrata",
      description: "Ingresso registrato con successo.",
    });
  }, [toast]);

  const handleClockOut = React.useCallback(() => {
    toast({
      title: "Timbratura Registrata",
      description: "Uscita registrata con successo.",
    });
  }, [toast]);

  const navItems = [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/scan-job', label: 'Scansione Commessa', icon: ScanLine },
      { href: '/operator-data', label: 'Dati Operatore', icon: Users },
      { href: '/report-problem', label: 'Segnala Problema', icon: AlertTriangle },
  ];

  return (
    <Card className="mb-6 p-2">
        <TooltipProvider delayDuration={0}>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {/* Dashboard */}
              <Tooltip>
                  <TooltipTrigger asChild>
                  <Link href="/dashboard" passHref>
                      <Button
                      variant={pathname === '/dashboard' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-12 w-12 text-muted-foreground data-[active=true]:text-inherit"
                      data-active={pathname === '/dashboard'}
                      aria-label="Dashboard"
                      >
                      <LayoutDashboard className="h-6 w-6" />
                      </Button>
                  </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                  <p>Dashboard</p>
                  </TooltipContent>
              </Tooltip>

              {/* Scansione Commessa PF */}
               <Tooltip>
                  <TooltipTrigger asChild>
                  <Link href="/scan-job" passHref>
                      <Button
                      variant={pathname === '/scan-job' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-12 w-12 text-muted-foreground data-[active=true]:text-inherit"
                      data-active={pathname === '/scan-job'}
                      aria-label="Scansione Commessa"
                      >
                      <ScanLine className="h-6 w-6" />
                      </Button>
                  </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                  <p>Scansione Commessa</p>
                  </TooltipContent>
              </Tooltip>
              
              {/* Scansione Materie Prime (Conditional) */}
              {operator && (operator.reparto === 'MAG' || operator.reparto === 'Officina') && (
                 <Tooltip>
                    <TooltipTrigger asChild>
                    <Link href="/raw-material-scan" passHref>
                        <Button
                        variant={pathname === '/raw-material-scan' ? 'default' : 'ghost'}
                        size="icon"
                        className="h-12 w-12 text-muted-foreground data-[active=true]:text-inherit"
                        data-active={pathname === '/raw-material-scan'}
                        aria-label="Scansione Materie Prime"
                        >
                        <Boxes className="h-6 w-6" />
                        </Button>
                    </Link>
                    </TooltipTrigger>
                    <TooltipContent>
                    <p>Scansione Materie Prime</p>
                    </TooltipContent>
                </Tooltip>
              )}

              {/* Dati Operatore */}
              <Tooltip>
                  <TooltipTrigger asChild>
                  <Link href="/operator-data" passHref>
                      <Button
                      variant={pathname === '/operator-data' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-12 w-12 text-muted-foreground data-[active=true]:text-inherit"
                      data-active={pathname === '/operator-data'}
                      aria-label="Dati Operatore"
                      >
                      <Users className="h-6 w-6" />
                      </Button>
                  </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                  <p>Dati Operatore</p>
                  </TooltipContent>
              </Tooltip>


              {/* Timbratrice Button */}
              <AlertDialog>
                <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-12 w-12 text-muted-foreground"
                          aria-label="Timbratrice"
                        >
                          <Clock className="h-6 w-6" />
                        </Button>
                      </AlertDialogTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Timbratrice</p>
                    </TooltipContent>
                </Tooltip>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Seleziona Azione Timbratura</AlertDialogTitle>
                    <AlertDialogDescription>
                      Vuoi registrare un orario di ingresso o di uscita?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClockIn}>
                      Registra Entrata
                    </AlertDialogAction>
                    <AlertDialogAction onClick={handleClockOut}>
                      Registra Uscita
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

               {/* Segnala Problema */}
              <Tooltip>
                  <TooltipTrigger asChild>
                  <Link href="/report-problem" passHref>
                      <Button
                      variant={pathname === '/report-problem' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-12 w-12 text-muted-foreground data-[active=true]:text-inherit"
                      data-active={pathname === '/report-problem'}
                      aria-label="Segnala Problema"
                      >
                      <AlertTriangle className="h-6 w-6" />
                      </Button>
                  </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                  <p>Segnala Problema</p>
                  </TooltipContent>
              </Tooltip>
            </div>
        </TooltipProvider>
    </Card>
  );
}
