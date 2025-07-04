
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Briefcase, Package2, Loader2 } from 'lucide-react';
import { getProductionJobOrders } from '@/app/admin/data-management/actions';
import type { JobOrder, JobPhase } from '@/lib/mock-data';
import type { OverallStatus } from '@/lib/types';
import JobOrderCard from '@/components/production-console/JobOrderCard';


function getOverallStatus(jobOrder: JobOrder): OverallStatus {
  // Priority 1: Terminal/Blocking states
  if (jobOrder.status === 'suspended') return 'Sospesa';
  if (jobOrder.isProblemReported) return 'Problema';
  if (jobOrder.status === 'completed') return 'Completata';

  // Check phases
  const preparationPhases = jobOrder.phases.filter(p => (p.type ?? 'production') === 'preparation');
  const productionPhases = jobOrder.phases.filter(p => (p.type ?? 'production') === 'production');

  const isAnyProductionActive = productionPhases.some(p => p.status === 'in-progress' || p.status === 'paused');
  if (isAnyProductionActive) {
    return 'In Lavorazione';
  }

  const allPreparationDone = preparationPhases.every(p => p.status === 'completed');
  if (preparationPhases.length > 0 && allPreparationDone) {
      return 'Pronto per Produzione';
  }

  const isAnyPreparationStarted = preparationPhases.some(p => p.status !== 'pending');
  if (isAnyPreparationStarted) {
    return 'In Preparazione';
  }
  
  // Default state if no other condition is met
  return 'Da Iniziare';
}

interface ProductionConsoleClientPageProps {
  initialJobOrders: JobOrder[];
}

export default function ProductionConsoleClientPage({ initialJobOrders }: ProductionConsoleClientPageProps) {
  const [jobOrders, setJobOrders] = useState<JobOrder[]>(initialJobOrders);
  const [isLoading, setIsLoading] = useState(false); // No longer loading initially
  const [activeFilter, setActiveFilter] = useState<OverallStatus | 'all'>('all');

  // If you need to refresh data after some action, you can create a function like this:
  // const refreshJobs = async () => {
  //   setIsLoading(true);
  //   const jobs = await getProductionJobOrders();
  //   setJobOrders(jobs);
  //   setIsLoading(false);
  // };

  const filteredJobs = useMemo(() => {
    if (activeFilter === 'all') {
      return jobOrders;
    }
    return jobOrders.filter(job => getOverallStatus(job) === activeFilter);
  }, [jobOrders, activeFilter]);

  const filterOptions: (OverallStatus | 'all')[] = [
    'all',
    'Da Iniziare',
    'In Preparazione',
    'Pronto per Produzione',
    'In Lavorazione',
    'Sospesa',
    'Problema'
  ];

  return (
    <div className="space-y-6">
      <AdminNavMenu />
      <div className="flex justify-between items-center gap-4 flex-wrap">
        <div className='space-y-2'>
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                <Briefcase className="h-8 w-8 text-primary" />
                Console Controllo Produzione
            </h1>
            <p className="text-muted-foreground">
                Panoramica in tempo reale delle commesse inviate in produzione.
            </p>
        </div>
      </div>
      
      <Card className="p-2 mb-6">
        <div className="flex flex-wrap items-center justify-center gap-2">
            {filterOptions.map(filter => (
            <Button
                key={filter}
                variant={activeFilter === filter ? 'default' : 'ghost'}
                onClick={() => setActiveFilter(filter)}
                className="capitalize px-3 py-1 h-auto"
            >
                {filter === 'all' ? 'Tutte' : filter}
            </Button>
            ))}
        </div>
      </Card>

      {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="mt-4 text-muted-foreground">Aggiornamento commesse...</p>
        </div>
      ) : filteredJobs.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredJobs.map(job => (
                <JobOrderCard key={job.id} jobOrder={job} />
            ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-lg mt-8">
            <Package2 className="h-16 w-16 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold text-muted-foreground">Nessuna Commessa Trovata</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2">
                Non ci sono commesse che corrispondono al filtro "{activeFilter}". Prova a selezionare un altro stato o
                <Link href="/admin/data-management" className="text-primary underline hover:text-primary/80"> crea un ODL</Link>.
            </p>
        </div>
      )}
    </div>
  );
}
