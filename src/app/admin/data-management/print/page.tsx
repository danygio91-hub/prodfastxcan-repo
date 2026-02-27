
"use client"

import type { JobOrder } from '@/lib/mock-data';
import { notFound, useSearchParams } from 'next/navigation';
import QRCode from 'react-qr-code';
import { PrintButton } from './PrintButton';
import { useEffect, useState, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { getJobDetailReport } from '@/app/admin/reports/actions';

function PrintPageContent() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get('jobId');
  const [job, setJob] = useState<JobOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (jobId) {
      getJobDetailReport(jobId)
        .then(data => {
          if (data) {
            setJob(data as unknown as JobOrder);
          } else {
            setError('Commessa non trovata.');
          }
        })
        .catch(() => setError('Errore nel caricamento della commessa.'))
        .finally(() => setLoading(false));
    } else {
      setError('ID Commessa non fornito.');
      setLoading(false);
    }
  }, [jobId]);

  if (loading) {
    return (
        <div className="flex items-center justify-center h-screen">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
    );
  }
  
  if (error || !job) {
    notFound();
  }
  
  const qrValue = `${job.ordinePF}@${job.details}@${job.qta}`;

  return (
    <div className="bg-gray-100 p-4 sm:p-8">
       <div className="max-w-4xl mx-auto">
        <div className="flex justify-end mb-4 print:hidden">
            <PrintButton />
        </div>
        <div id="printable-area" className="bg-white p-6 rounded-lg shadow-lg">
            {/* Header */}
            <div className="flex justify-between items-start border-b-2 border-black pb-4">
                <div>
                    <h1 className="text-3xl font-bold">SCHEDA DI LAVORAZIONE</h1>
                    <h2 className="text-xl text-gray-700">ORDINE DI LAVORO (ODL)</h2>
                </div>
                <div className="w-24 h-24 p-1 border">
                     <QRCode value={qrValue} size={94} style={{ height: "auto", maxWidth: "100%", width: "100%" }} viewBox={`0 0 256 256`} />
                </div>
            </div>
            
            {/* Job Details */}
            <div className="grid grid-cols-3 gap-x-4 gap-y-2 mt-4 border-b-2 border-black pb-4">
                <div className="col-span-2"><strong>CLIENTE:</strong> {job.cliente}</div>
                <div><strong>DATA:</strong> {new Date().toLocaleDateString('it-IT')}</div>
                <div className="col-span-2"><strong>ORD. PF:</strong> <span className="font-bold text-lg">{job.ordinePF}</span></div>
                <div><strong>ORD. NR. EST:</strong> {job.numeroODL}</div>
                <div><strong>N° ODL:</strong> {job.numeroODLInterno}</div>
                <div><strong>DATA CONS:</strong> {job.dataConsegnaFinale}</div>
                <div><strong>QTA:</strong> <span className="font-bold text-lg">{job.qta}</span></div>
                <div className="col-span-3"><strong>CODICE:</strong> <span className="font-bold">{job.details}</span></div>
            </div>

            {/* Phases Table */}
            <div className="mt-4">
                <table className="w-full border-collapse border border-black">
                    <thead>
                        <tr className="bg-gray-200">
                            <th className="border border-black p-2 text-left">Fase</th>
                            <th className="border border-black p-2 text-left">Materiale</th>
                            <th className="border border-black p-2 text-left">Note</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(job.phases || []).sort((a, b) => a.sequence - b.sequence).map(phase => (
                            <tr key={phase.id}>
                                <td className="border border-black p-2 font-semibold w-1/3">{phase.name}</td>
                                <td className="border border-black p-2 w-1/3"></td>
                                <td className="border border-black p-2 w-1/3"></td>
                            </tr>
                        ))}
                        {/* Add empty rows for spacing if needed */}
                        {Array.from({ length: Math.max(0, 10 - (job.phases || []).length) }).map((_, index) => (
                             <tr key={`empty-${index}`}>
                                <td className="border border-black p-2 h-10"></td>
                                <td className="border border-black p-2"></td>
                                <td className="border border-black p-2"></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

             {/* Footer Notes */}
            <div className="mt-4">
                <div className="border border-black p-2">
                    <p className="font-bold mb-1">NOTE:</p>
                    <div className="h-20"></div>
                </div>
            </div>
        </div>
      </div>
       <style jsx global>{`
        @media print {
          body {
            background-color: white;
          }
          .printable-area {
             box-shadow: none;
             margin: 0;
             padding: 0;
          }
        }
      `}</style>
    </div>
  );
}


export default function ODLPrintPage() {
  return (
    <Suspense fallback={
        <div className="flex items-center justify-center h-screen">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
    }>
        <PrintPageContent />
    </Suspense>
  );
}
