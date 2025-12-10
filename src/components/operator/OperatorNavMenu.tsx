
"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { LayoutDashboard, Users, ScanLine, AlertTriangle, Clock, PackagePlus, SearchCheck, Warehouse } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';

function OperatorNavMenu() {
  const pathname = usePathname();
  const { operator } = useAuth();

  const allowedAccessReparti = ['MAG', 'Collaudo'];
  const hasMagAccess = operator && (
    operator.role === 'supervisor' || 
    (Array.isArray(operator.reparto) 
      ? operator.reparto.some(r => allowedAccessReparti.includes(r)) 
      : allowedAccessReparti.includes(operator.reparto))
  );

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/scan-job', label: 'Scansione Commessa', icon: ScanLine },
    ...(hasMagAccess ? [
      { href: '/material-loading', label: 'Carico Merce', icon: PackagePlus },
      { href: '/material-check', label: 'Verifica Materiale', icon: SearchCheck }
    ] : []),
    ...(operator?.canAccessInventory ? [{ href: '/inventory', label: 'Inventario', icon: Warehouse }] : []),
    { href: '/operator', label: 'Dati Operatore', icon: Users },
    { href: '/report-problem', label: 'Segnala Problema', icon: AlertTriangle },
  ];

  return (
    <div className="w-full bg-card rounded-lg shadow-sm mb-6">
        <TooltipProvider delayDuration={0}>
            <div className="flex items-center justify-center p-1 flex-wrap">
              {navItems.map((item) => (
                <Tooltip key={item.href}>
                    <TooltipTrigger asChild>
                    <Link href={item.href} passHref>
                        <Button
                        variant={pathname.startsWith(item.href) ? 'default' : 'ghost'}
                        size="lg"
                        className="h-14 w-14 m-1"
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
              ))}
               <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="lg"
                      className="h-14 w-14 m-1 text-muted-foreground"
                      aria-label="Timbratrice"
                      disabled
                    >
                      <Clock className="h-6 w-6" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Timbratrice (Prossimamente)</p>
                  </TooltipContent>
              </Tooltip>
            </div>
        </TooltipProvider>
    </div>
  );
}

export default React.memo(OperatorNavMenu);
