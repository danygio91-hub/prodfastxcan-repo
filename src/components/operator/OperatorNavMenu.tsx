"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { LayoutDashboard, Users, ScanLine, AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
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

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/operator-data', label: 'Dati Operatore', icon: Users },
  { href: '/scan-job', label: 'Scansione Commessa', icon: ScanLine },
  { href: '/report-problem', label: 'Segnala Problema', icon: AlertTriangle },
];

const ClockInOutButton = () => {
    const { toast } = useToast();

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

    return (
        <AlertDialog>
            <Tooltip>
                <TooltipTrigger asChild>
                    <AlertDialogTrigger asChild>
                         <Button
                            variant={'ghost'}
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
    )
}

export default function OperatorNavMenu() {
  const pathname = usePathname();

  return (
    <Card className="mb-6 p-2">
        <TooltipProvider delayDuration={0}>
            <div className="flex items-center justify-center gap-2 flex-wrap">
            {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                <Tooltip key={item.href}>
                    <TooltipTrigger asChild>
                    <Link href={item.href} passHref>
                        <Button
                        variant={isActive ? 'default' : 'ghost'}
                        size="icon"
                        className={cn(
                            "h-12 w-12",
                             !isActive && "text-muted-foreground"
                        )}
                        aria-label={item.label}
                        >
                        <item.icon className="h-6 w-6" />
                        </Button>
                    </Link>
                    </TooltipTrigger>
                    <TooltipContent>
                    <p>{item.label}</p>
                    </TooltipContent>
                </Tooltip>
                );
            })}
            <ClockInOutButton />
            </div>
        </TooltipProvider>
    </Card>
  );
}
