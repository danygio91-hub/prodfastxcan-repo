
"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { LayoutDashboard, Users, ScanLine, AlertTriangle, Clock, PackagePlus, SearchCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/components/auth/AuthProvider';

function OperatorNavMenu() {
  const pathname = usePathname();
  const { operator } = useAuth();

  const hasMagAccess = operator && (operator.role === 'superadvisor' || (Array.isArray(operator.reparto) ? operator.reparto.includes('MAG') : operator.reparto === 'MAG'));

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
              
              {/* Carico Materiale & Verifica Materiale (Conditional) */}
              {hasMagAccess && (
                <>
                 <Tooltip>
                    <TooltipTrigger asChild>
                    <Link href="/material-loading" passHref>
                        <Button
                        variant={pathname === '/material-loading' ? 'default' : 'ghost'}
                        size="icon"
                        className="h-12 w-12 text-muted-foreground data-[active=true]:text-inherit"
                        data-active={pathname === '/material-loading'}
                        aria-label="Carico Merce"
                        >
                        <PackagePlus className="h-6 w-6" />
                        </Button>
                    </Link>
                    </TooltipTrigger>
                    <TooltipContent>
                    <p>Carico Merce</p>
                    </TooltipContent>
                </Tooltip>
                 <Tooltip>
                    <TooltipTrigger asChild>
                    <Link href="/material-check" passHref>
                        <Button
                        variant={pathname === '/material-check' ? 'default' : 'ghost'}
                        size="icon"
                        className="h-12 w-12 text-muted-foreground data-[active=true]:text-inherit"
                        data-active={pathname === '/material-check'}
                        aria-label="Verifica Materiale"
                        >
                        <SearchCheck className="h-6 w-6" />
                        </Button>
                    </Link>
                    </TooltipTrigger>
                    <TooltipContent>
                    <p>Verifica Materiale</p>
                    </TooltipContent>
                </Tooltip>
                </>
              )}

              {/* Dati Operatore */}
              <Tooltip>
                  <TooltipTrigger asChild>
                  <Link href="/operator" passHref>
                      <Button
                      variant={pathname === '/operator' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-12 w-12 text-muted-foreground data-[active=true]:text-inherit"
                      data-active={pathname === '/operator'}
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
              <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-12 w-12 text-muted-foreground"
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

export default React.memo(OperatorNavMenu);
