
"use client";

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { LogOut, RefreshCw, LayoutDashboard, ListChecks, Briefcase, BarChart3, Settings, Building2, Boxes, ShieldAlert, Timer, Combine, ClipboardList, Warehouse } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useActiveJob } from '@/contexts/ActiveJobProvider';
import { useToast } from '@/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from '@/lib/utils';

const adminNavItems = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/data-management', label: 'Gestione Dati Commesse', icon: ListChecks },
  { href: '/admin/raw-material-management', label: 'Materie Prime', icon: Boxes },
  { href: '/admin/article-management', label: 'Anagrafica Articoli', icon: ClipboardList },
  { href: '/admin/production-console', label: 'Console Produzione', icon: Briefcase },
  { href: '/admin/work-group-management', label: 'Gruppi Commesse', icon: Combine },
  { href: '/admin/inventory-management', label: 'Inventari', icon: Warehouse },
  { href: '/admin/reports', label: 'Report', icon: BarChart3 },
  { href: '/admin/production-time-analysis', label: 'Analisi Tempi', icon: Timer },
  { href: '/admin/non-conformity-reports', label: 'Non Conformità', icon: ShieldAlert },
  { href: '/admin/settings', label: 'Configurazione Azienda', icon: Building2 },
  { href: '/admin/app-settings', label: 'Gestione App', icon: Settings },
];

export default function Header() {
  const { operator, logout } = useAuth();
  const { activeJob, setActiveJobId } = useActiveJob();
  const pathname = usePathname();
  const { toast } = useToast();
  
  const handleRefresh = () => {
    window.location.reload();
  };

  const handleExitJobScreen = () => {
    if (!activeJob) return;
    toast({ title: "Sei uscito dalla schermata della commessa", description: "La fase attiva rimane in corso in background."});
  };

  const getInitials = (name: string | null) => {
    if (!name) return 'OP';
    const names = name.split(' ');
    const firstInitial = names[0]?.[0] || '';
    const lastInitial = names.length > 1 ? names[names.length - 1][0] : (names[0]?.[1] || '');
    return `${firstInitial}${lastInitial}`.toUpperCase();
  };
  
  const operatorName = operator ? operator.nome : null;
  const isAdmin = operator?.role === 'admin';
  const isAdminPage = pathname.startsWith('/admin');

  const avatarName = operator ? operator.nome : 'Operatore';
  const displayInitials = getInitials(avatarName);
  
  const showExitButton = pathname === '/scan-job' && activeJob;

  const homeLink = isAdmin ? '/admin/dashboard' : '/dashboard';

  return (
    <header className="bg-card border-b border-border shadow-sm sticky top-0 z-40">
      <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
            <Link href={homeLink} className="flex items-center text-xl font-bold font-headline text-primary">
                <Image src="/logo.png" alt="PFXcan Logo" width={50} height={33} unoptimized={true} />
            </Link>
        </div>

        {isAdminPage && (
          <div className="flex-1 hidden md:flex items-center justify-center">
             <TooltipProvider delayDuration={0}>
                <div className="flex items-center justify-center p-2 gap-2 flex-wrap">
                {adminNavItems.map((item) => {
                    const isActive = pathname.startsWith(item.href);
                    return (
                    <Tooltip key={item.href}>
                        <TooltipTrigger asChild>
                        <Link href={item.href} passHref>
                            <Button
                            variant={isActive ? 'default' : 'ghost'}
                            size="icon"
                            className={cn(
                                "h-10 w-10",
                                !isActive && "text-muted-foreground hover:bg-muted/50"
                            )}
                            aria-label={item.label}
                            >
                            <item.icon className="h-5 w-5" />
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
        )}

        <div className="flex items-center space-x-2">
          <TooltipProvider delayDuration={0}>
            {showExitButton && (
                 <Tooltip>
                    <TooltipTrigger asChild>
                        <Button asChild variant="destructive" size="icon" onClick={handleExitJobScreen} aria-label="Esci dalla commessa">
                           <Link href="/dashboard">
                              <LogOut className="h-5 w-5" />
                           </Link>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Esci dalla schermata della commessa</p>
                    </TooltipContent>
                </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleRefresh} aria-label="Aggiorna pagina">
                  <RefreshCw className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Aggiorna pagina</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

           <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={`https://placehold.co/100x100.png?text=${displayInitials}`} alt={avatarName} data-ai-hint="avatar persona" />
                  <AvatarFallback>{displayInitials}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">Accesso come</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {operatorName || "Operatore"}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="cursor-pointer">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Esci</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
