
"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { LayoutDashboard, ListChecks, Briefcase, BarChart3, Settings, Building2, Boxes, ShieldAlert, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

const navItems = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/data-management', label: 'Gestione Dati Commesse', icon: ListChecks },
  { href: '/admin/raw-material-management', label: 'Materie Prime', icon: Boxes },
  { href: '/admin/production-console', label: 'Console Produzione', icon: Briefcase },
  { href: '/admin/reports', label: 'Report', icon: BarChart3 },
  { href: '/admin/production-time-analysis', label: 'Analisi Tempi', icon: Timer },
  { href: '/admin/non-conformity-reports', label: 'Non Conformità', icon: ShieldAlert },
  { href: '/admin/settings', label: 'Configurazione Azienda', icon: Building2 },
  { href: '/admin/app-settings', label: 'Gestione App', icon: Settings },
];

function AdminNavMenu() {
  const pathname = usePathname();

  return (
    <div className="w-full bg-card rounded-lg shadow-sm mb-6">
      <TooltipProvider delayDuration={0}>
          <div className="flex items-center justify-center p-2 gap-2 flex-wrap">
          {navItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
              <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                  <Link href={item.href} passHref>
                      <Button
                      variant={isActive ? 'default' : 'ghost'}
                      size="lg"
                      className={cn(
                          "h-14 w-14",
                           !isActive && "text-muted-foreground hover:bg-muted/50"
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
          </div>
      </TooltipProvider>
    </div>
  );
}

export default React.memo(AdminNavMenu);
