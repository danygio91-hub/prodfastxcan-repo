

"use client";

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { LogOut, RefreshCw } from 'lucide-react';
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


export default function Header() {
  const { operator, logout } = useAuth();
  const { activeJob, setActiveJobId } = useActiveJob();
  const pathname = usePathname();
  const { toast } = useToast();
  
  const operatorName = operator ? operator.nome : null;

  const handleRefresh = () => {
    window.location.reload();
  };

  const handleExitJobScreen = () => {
    // This action only navigates away. The active phase (and banner) will persist.
    // The user must explicitly pause or complete the phase via the status bar.
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
  
  const avatarName = operator ? operator.nome + (operator.cognome ? ` ${operator.cognome}` : '') : 'Operatore';
  const displayInitials = getInitials(avatarName);
  
  const showExitButton = pathname === '/scan-job' && activeJob;

  return (
    <header className="bg-card border-b border-border shadow-sm sticky top-0 z-40">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center text-xl font-bold font-headline text-primary">
                <Image src="/logo.png" alt="PFXcan Logo" width={50} height={33} unoptimized={true} />
            </Link>
        </div>
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
