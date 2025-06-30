"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { LayoutDashboard, Users, ScanLine, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/operator-data', label: 'Dati Operatore', icon: Users },
  { href: '/scan-job', label: 'Scansione Commessa', icon: ScanLine },
  { href: '/report-problem', label: 'Segnala Problema', icon: AlertTriangle },
];

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
            </div>
        </TooltipProvider>
    </Card>
  );
}
