
"use client"

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, AlertCircle, Printer } from 'lucide-react';
import { getJobDetailReport } from '@/app/admin/reports/actions';
import { getRequiredDataForJobs } from '@/app/admin/data-management/actions';
import { Button } from '@/components/ui/button';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import type { JobOrder, RawMaterial, Article } from '@/lib/mock-data';
import ODLPrintTemplate from '@/components/production-console/ODLPrintTemplate';
import { getODLConfig } from '@/app/admin/settings/odl-actions';
import { ODLConfig, DEFAULT_ODL_CONFIG } from '@/lib/odl-config';

function PrintPageContent() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get('jobId');
  
  const [job, setJob] = useState<JobOrder | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [config, setConfig] = useState<ODLConfig>(DEFAULT_ODL_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      if (!jobId) {
        setError('ID Commessa non fornito.');
        setLoading(false);
        return;
      }

      try {
        const [jobData, odlConfig] = await Promise.all([
          getJobDetailReport(jobId),
          getODLConfig()
        ]);

        setConfig(odlConfig);

        if (jobData) {
          const typedJob = jobData as unknown as JobOrder;
          setJob(typedJob);
          
          const req = await getRequiredDataForJobs([typedJob]);
          
          const matchedArticle = req.articles.find(a => a.code.toUpperCase() === typedJob.details.toUpperCase());
          setArticle(matchedArticle || null);
          setMaterials(req.materials);
        } else {
          setError('Commessa non trovata.');
        }
      } catch (err) {
        console.error("Errore fetch stampa:", err);
        setError('Errore durante il recupero dei dati.');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [jobId]);

  if (loading) {
    return (
        <div className="flex flex-col items-center justify-center h-screen gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground font-medium">Generazione Scheda di Lavorazione...</p>
        </div>
    );
  }
  
  if (error || !job) {
    return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-4 text-center">
            <AlertCircle className="h-16 w-16 text-destructive" />
            <h1 className="text-2xl font-bold">{error || 'Errore di sistema'}</h1>
            <Button onClick={() => window.close()} variant="outline">Chiudi</Button>
        </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-neutral-100 py-8 print:bg-white print:py-0">
       <div className="max-w-[29.7cm] mx-auto bg-white shadow-2xl print:shadow-none min-h-[21cm] p-[0.5cm]">
        
        <div className="flex justify-between items-center mb-6 print:hidden bg-slate-800 text-white p-4 rounded-lg">
            <div className="space-y-1">
                <h3 className="font-bold text-lg">Anteprima Scheda Lavorazione (ODL)</h3>
                <p className="text-xs opacity-70">Verifica i dati. La stampa è ottimizzata per A4 Orizzontale.</p>
            </div>
            <div className="flex gap-2 text-black">
                <Button variant="secondary" onClick={() => window.close()} size="sm" className="bg-slate-700 hover:bg-slate-600 text-white border-0">Chiudi</Button>
                <Button onClick={() => window.print()} size="sm" className="text-white"><Printer className="mr-2 h-4 w-4"/>Stampa Ora</Button>
            </div>
        </div>

        <ODLPrintTemplate 
            job={job}
            article={article}
            materials={materials}
            config={config}
        />
      </div>

       <style jsx global>{`
        @page {
          size: landscape;
          margin: 0;
        }
        @media print {
          body {
            background-color: white !important;
            -webkit-print-color-adjust: exact;
            margin: 0;
            padding: 0;
          }
          .print\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}

export default function ODLPrintPage() {
  return (
    <AdminAuthGuard>
        <Suspense fallback={
            <div className="flex flex-col items-center justify-center h-screen gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-muted-foreground animate-pulse">Caricamento...</p>
            </div>
        }>
            <PrintPageContent />
        </Suspense>
    </AdminAuthGuard>
  );
}
