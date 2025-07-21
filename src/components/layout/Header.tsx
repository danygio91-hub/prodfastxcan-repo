
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
import { updateJob } from '@/app/scan-job/actions';
import ActiveMaterialSessionBar from '@/components/operator/ActiveMaterialSessionBar';
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

  const handleAbandonJob = async () => {
    if (!activeJob) return;

    const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
    
    const activePhase = jobToUpdate.phases.find((p: any) => p.status === 'in-progress');
    if (activePhase) {
      const lastWorkPeriod = activePhase.workPeriods[activePhase.workPeriods.length - 1];
      if (lastWorkPeriod && !lastWorkPeriod.end) {
        lastWorkPeriod.end = new Date();
      }
      activePhase.status = 'paused';
    }
    
    jobToUpdate.status = 'suspended';

    const result = await updateJob(jobToUpdate);
    if (result.success) {
      toast({
        title: "Commessa Abbandonata",
        description: `La commessa ${jobToUpdate.id} è stata sospesa.`,
      });
      setActiveJobId(null);
    } else {
      toast({
        variant: "destructive",
        title: "Errore",
        description: "Impossibile abbandonare la commessa. Riprova.",
      });
    }
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

  const showAbandonButton = pathname === '/scan-job' && activeJob;

  return (
    <header className="bg-card border-b border-border shadow-sm sticky top-0 z-40">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center text-xl font-bold font-headline text-primary">
          <Image src="/logo.png" alt="PFXcan Logo" width={75} height={50} className="mr-3" unoptimized={true} />
        </Link>
        <div className="flex items-center space-x-2">
          <TooltipProvider delayDuration={0}>
            {showAbandonButton && (
                 <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="destructive" size="icon" onClick={handleAbandonJob} aria-label="Esci dalla commessa">
                            <LogOut className="h-5 w-5" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Esci dalla commessa</p>
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
      {operator && operator.role !== 'admin' && <ActiveMaterialSessionBar />}
    </header>
  );
}
