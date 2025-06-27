"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { LayoutDashboard, ListChecks, Briefcase, BarChart3, Users, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

const navItems = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/data-management', label: 'Gestione Dati', icon: ListChecks },
  { href: '/admin/production-console', label: 'Console Produzione', icon: Briefcase },
  { href: '/admin/reports', label: 'Report', icon: BarChart3 },
  { href: '/admin/operator-management', label: 'Gestione Operatori', icon: Users },
  { href: '/admin/settings', label: 'Configurazione', icon: Settings },
];

export default function AdminNavMenu() {
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
            </div>
        </TooltipProvider>
    </Card>
  );
}
