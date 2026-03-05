
"use client"

import type { JobOrder, RawMaterial, Article, JobBillOfMaterialsItem } from '@/lib/mock-data';
import { useSearchParams } from 'next/navigation';
import QRCode from 'react-qr-code';
import { PrintButton } from './PrintButton';
import { useEffect, useState, Suspense, useMemo } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { getJobDetailReport } from '@/app/admin/reports/actions';
import { getArticles } from '@/app/admin/article-management/actions';
import { getRawMaterials } from '@/app/admin/raw-material-management/actions';
import { formatDisplayStock } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { format, parseISO, isValid } from 'date-fns';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/AuthProvider';

function PrintPageContent() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get('jobId');
  const { operator, loading: authLoading } = useAuth();
  
  const [job, setJob] = useState<JobOrder | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
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
        const [jobData, allArticles, allMaterials] = await Promise.all([
          getJobDetailReport(jobId),
          getArticles(),
          getRawMaterials()
        ]);

        if (jobData) {
          setJob(jobData as unknown as JobOrder);
          const matchedArticle = allArticles.find(a => a.code.toUpperCase() === jobData.details.toUpperCase());
          setArticle(matchedArticle || null);
          setMaterials(allMaterials);
        } else {
          setError('Commessa non trovata nel database.');
        }
      } catch (err) {
        console.error("Errore fetch stampa:", err);
        setError('Si è verificato un errore durante il recupero dei dati.');
      } finally {
        setLoading(false);
      }
    }

    if (!authLoading) {
        fetchData();
    }
  }, [jobId, authLoading]);

  const materialsMap = useMemo(() => new Map(materials.map(m => [m.code.toUpperCase(), m])), [materials]);

  // Suddivisione componenti per tipologia ministeriale
  const groupedBOM = useMemo(() => {
    if (!job?.billOfMaterials) return { treccia: [], tubi: [], guaina: [] };

    const treccia: JobBillOfMaterialsItem[] = [];
    const tubi: JobBillOfMaterialsItem[] = [];
    const guaina: JobBillOfMaterialsItem[] = [];

    job.billOfMaterials.forEach(item => {
      const mat = materialsMap.get(item.component.toUpperCase());
      const type = mat?.type;

      if (type === 'TUBI') {
        tubi.push(item);
      } else if (type === 'GUAINA') {
        guaina.push(item);
      } else {
        treccia.push(item);
      }
    });

    return { treccia, tubi, guaina };
  }, [job, materialsMap]);

  // Calcolo Stime Tempi
  const estimatedTimes = useMemo(() => {
    if (!article?.phaseTimes) return { treccia: 'N/D', tubi: 'N/D', guaina: 'N/D' };

    const formatMins = (mins: number) => {
        if (!mins || mins <= 0) return 'N/D';
        const totalMins = mins * (job?.qta || 1);
        const h = Math.floor(totalMins / 60);
        const m = Math.round(totalMins % 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    const trecciaTime = article.phaseTimes['phase-template-1']?.expectedMinutesPerPiece || 0;
    const tubiTime = article.phaseTimes['phase-template-7']?.expectedMinutesPerPiece || 0;
    const guainaTime = article.phaseTimes['phase-template-6']?.expectedMinutesPerPiece || 0;

    return {
      treccia: formatMins(trecciaTime),
      tubi: formatMins(tubiTime),
      guaina: formatMins(guainaTime)
    };
  }, [article, job]);

  if (loading || authLoading) {
    return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 bg-background">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground font-medium">Generazione Scheda di Lavorazione...</p>
        </div>
    );
  }
  
  if (error || !job) {
    return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-4 text-center bg-background">
            <AlertCircle className="h-16 w-16 text-destructive" />
            <h1 className="text-2xl font-bold">{error || 'Errore di sistema'}</h1>
            <Button onClick={() => window.close()} variant="outline">Chiudi</Button>
        </div>
    );
  }
  
  const qrValue = `${job.ordinePF}@${job.details}@${job.qta}`;

  const formatDateSafe = (dateInput: any) => {
      if (!dateInput) return '---';
      const d = typeof dateInput === 'string' ? parseISO(dateInput) : new Date(dateInput);
      return isValid(d) ? format(d, 'dd/MM/yyyy') : '---';
  };

  return (
    <div className="min-h-screen bg-neutral-100 py-8 print:bg-white print:py-0">
       <div className="max-w-[29.7cm] mx-auto bg-white shadow-2xl print:shadow-none min-h-[21cm] p-[1cm]">
        
        {/* Print Controls (Hidden on print) */}
        <div className="flex justify-between items-center mb-6 print:hidden bg-slate-800 text-white p-4 rounded-lg">
            <div className="space-y-1">
                <h3 className="font-bold">Anteprima di Stampa ODL</h3>
                <p className="text-xs opacity-70">Verifica l'anteprima prima di stampare su carta A4 Orizzontale.</p>
            </div>
            <div className="flex gap-2">
                <Button variant="secondary" onClick={() => window.close()} size="sm" className="bg-slate-700 hover:bg-slate-600 text-white border-0">Chiudi</Button>
                <PrintButton />
            </div>
        </div>

        {/* --- ODL DOCUMENT START --- */}
        <div id="odl-document" className="text-[10px] leading-tight font-sans text-black border-2 border-black p-4">
            
            {/* Header Module Info */}
            <div className="flex justify-between items-end mb-4">
                <div className="w-24">
                    <img src="/logo.png" alt="PF" className="w-full h-auto grayscale" onError={(e) => e.currentTarget.style.display = 'none'} />
                </div>
                <div className="flex-1 text-center">
                    <h1 className="text-2xl font-black underline tracking-widest">SCHEDA DI LAVORAZIONE</h1>
                </div>
                <div className="text-[8px] text-right font-mono font-bold">
                    MOD. 800_5_02 REV.0 del 08/05/2024
                </div>
            </div>

            {/* Top Grid Info */}
            <div className="grid grid-cols-5 border-2 border-black mb-4">
                <div className="border-r-2 border-black p-2 text-center bg-white">
                    <span className="block text-[7px] font-bold uppercase text-gray-500">Reparto</span>
                    <span className="font-bold text-sm">{job.department || 'N/D'}</span>
                </div>
                <div className="border-r-2 border-black p-2 text-center bg-white">
                    <span className="block text-[7px] font-bold uppercase text-gray-500">Data ODL</span>
                    <span className="font-bold text-sm">{formatDateSafe(job.odlCreationDate || new Date())}</span>
                </div>
                <div className="border-r-2 border-black p-2 text-center bg-white">
                    <span className="block text-[7px] font-bold uppercase text-gray-500">N° Ord. Interno</span>
                    <span className="font-bold text-sm">{job.numeroODLInterno || '---'}</span>
                </div>
                <div className="border-r-2 border-black p-2 text-center bg-blue-100">
                    <span className="block text-[7px] font-bold uppercase text-blue-800">Numero Ordine PF</span>
                    <span className="font-black text-lg">{job.ordinePF}</span>
                </div>
                <div className="p-2 text-center bg-emerald-50">
                    <span className="block text-[7px] font-bold uppercase text-emerald-800">N° ODL</span>
                    <span className="font-bold text-sm text-emerald-700">{job.numeroODL || '---'}</span>
                </div>
            </div>

            {/* Main Info Area */}
            <div className="grid grid-cols-12 gap-0 border-2 border-black mb-4 min-h-[180px]">
                <div className="col-span-4 border-r-2 border-black flex flex-col">
                    <div className="grid grid-cols-3 flex-1">
                        <div className="col-span-1 border-b-2 border-black p-2 font-black uppercase bg-gray-100 flex items-center">Cliente</div>
                        <div className="col-span-2 border-b-2 border-black p-2 flex items-center font-bold text-xs">{job.cliente}</div>
                        
                        <div className="col-span-1 border-b-2 border-black p-2 font-black uppercase bg-gray-100 flex items-center">Codice Articolo</div>
                        <div className="col-span-2 border-b-2 border-black p-2 flex items-center font-black text-lg tracking-tighter">{job.details}</div>
                        
                        <div className="col-span-1 border-b-2 border-black p-2 font-black uppercase bg-gray-100 flex items-center">Disegno</div>
                        <div className="col-span-2 border-b-2 border-black p-2 flex items-center italic text-gray-400">---</div>
                        
                        <div className="col-span-1 border-b-2 border-black p-2 font-black uppercase bg-gray-100 flex items-center">QT</div>
                        <div className="col-span-2 border-b-2 border-black p-2 flex items-center font-black text-2xl">{job.qta}</div>
                        
                        <div className="col-span-1 p-2 font-black uppercase bg-gray-100 flex items-center leading-none text-[8px]">Data Fine Prep. Materiale</div>
                        <div className="col-span-2 p-2 flex items-center font-black text-sm text-red-600">{formatDateSafe(job.dataConsegnaFinale)}</div>
                    </div>
                </div>
                <div className="col-span-3 border-r-2 border-black flex flex-col items-center justify-center p-4 relative bg-white">
                    <span className="absolute top-2 text-[8px] text-blue-600 font-black uppercase tracking-widest">CODICE COMMESSA</span>
                    <div className="w-full flex justify-center">
                        <QRCode value={qrValue} size={140} style={{ height: "auto", maxWidth: "100%", width: "100%" }} viewBox={`0 0 256 256`} />
                    </div>
                </div>
                <div className="col-span-5 p-4 text-center flex items-center justify-center italic bg-gray-50/30">
                    <p className="text-gray-300 text-sm font-medium tracking-widest uppercase opacity-50">SPAZIO PER DISEGNO TECNICO / NOTE AGGIUNTIVE</p>
                </div>
            </div>

            {/* Preparation Section Header */}
            <div className="bg-gray-800 text-white border-2 border-black p-1.5 text-center font-black uppercase tracking-[0.3em] mb-2 text-xs">
                PREPARAZIONE COMPONENTI COMMESSE (REPARTO MAGAZZINO)
            </div>

            {/* --- TABLE 1: TRECCIA / CORDA --- */}
            <div className="mb-4">
                <table className="w-full border-collapse border-2 border-black text-center table-fixed">
                    <thead>
                        <tr className="bg-gray-100 text-[9px] font-black uppercase border-b-2 border-black h-8">
                            <th className="border-r-2 border-black w-[25%]">TRECCIA/CORDA</th>
                            <th className="border-r-2 border-black w-[12%]">L TAGLIO mm (Toll)</th>
                            <th className="border-r-2 border-black w-[8%]">QT</th>
                            <th className="border-r-2 border-black w-[15%]">VERIFICA MISURA mm</th>
                            <th className="border-r-2 border-black w-[8%]">COMPLETATO</th>
                            <th className="border-r-2 border-black w-[12%] leading-none px-1">STIMA TEMPO TAGLIO (HH:MM)</th>
                            <th className="w-[20%]">ALERT</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groupedBOM.treccia.length > 0 ? groupedBOM.treccia.map((item, i) => (
                            <tr key={i} className="border-b-2 border-black even:bg-slate-50/50 h-10">
                                <td className="border-r-2 border-black px-2 font-black text-left text-sm">{item.component}</td>
                                <td className="border-r-2 border-black font-mono text-xs">{item.lunghezzaTaglioMm || '---'}</td>
                                <td className="border-r-2 border-black font-black text-sm">{(item.quantity * job.qta).toFixed(0)}</td>
                                <td className="border-r-2 border-black text-gray-400">| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; |</td>
                                <td className="border-r-2 border-black text-lg">□</td>
                                {i === 0 && (
                                    <td rowSpan={groupedBOM.treccia.length} className="border-r-2 border-black p-2 bg-gray-50/50 font-black text-sm">
                                        {estimatedTimes.treccia}
                                    </td>
                                )}
                                <td className="px-2 text-[8px] italic text-left leading-tight">{item.note || ''}</td>
                            </tr>
                        )) : (
                            <tr className="h-10 border-b-2 border-black"><td colSpan={7} className="italic text-gray-400">Nessun componente Treccia/Corda</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* --- TABLE 2: CODICE TUBI --- */}
            <div className="mb-4">
                <table className="w-full border-collapse border-2 border-black text-center table-fixed">
                    <thead>
                        <tr className="bg-gray-100 text-[9px] font-black uppercase border-b-2 border-black h-8">
                            <th className="border-r-2 border-black w-[30%]">CODICE TUBI</th>
                            <th className="border-r-2 border-black w-[10%]">QT (N°)</th>
                            <th className="border-r-2 border-black w-[10%]">QT (KG.)</th>
                            <th className="border-r-2 border-black w-[15%]">VERIFICA MISURE</th>
                            <th className="border-r-2 border-black w-[10%] leading-none px-1">PRELEVATO DA MAG</th>
                            <th className="leading-none px-1">STIMA TEMPO PREPARAZIONE (MINUTI)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groupedBOM.tubi.length > 0 ? groupedBOM.tubi.map((item, i) => {
                            const mat = materialsMap.get(item.component.toUpperCase());
                            const totalPcs = item.quantity * job.qta;
                            const totalKg = mat?.conversionFactor ? (totalPcs * mat.conversionFactor) : 0;
                            
                            return (
                                <tr key={i} className="border-b-2 border-black even:bg-slate-50/50 h-10">
                                    <td className="border-r-2 border-black px-2 font-black text-left text-sm">{item.component}</td>
                                    <td className="border-r-2 border-black font-black text-sm">{totalPcs.toFixed(0)}</td>
                                    <td className="border-r-2 border-black font-mono text-xs">{totalKg > 0 ? totalKg.toFixed(2) : '---'}</td>
                                    <td className="border-r-2 border-black text-gray-400">| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; |</td>
                                    <td className="border-r-2 border-black text-lg">□</td>
                                    {i === 0 && (
                                        <td rowSpan={groupedBOM.tubi.length} className="p-2 bg-gray-50/50 font-black text-sm">
                                            {estimatedTimes.tubi}
                                        </td>
                                    )}
                                </tr>
                            );
                        }) : (
                            <tr className="h-10 border-b-2 border-black"><td colSpan={6} className="italic text-gray-400">Nessun componente Tubi</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* --- TABLE 3: GUAINA --- */}
            <div className="mb-4">
                <table className="w-full border-collapse border-2 border-black text-center table-fixed">
                    <thead>
                        <tr className="bg-gray-100 text-[9px] font-black uppercase border-b-2 border-black h-8">
                            <th className="border-r-2 border-black w-[20%]">GUAINA</th>
                            <th className="border-r-2 border-black w-[12%]">L TAGLIO mm (Toll)</th>
                            <th className="border-r-2 border-black w-[8%]">QT</th>
                            <th className="border-r-2 border-black w-[10%]">MT. GUAINA</th>
                            <th className="border-r-2 border-black w-[15%]">VERIFICA MISURA mm</th>
                            <th className="border-r-2 border-black w-[8%]">COMPLETATO</th>
                            <th className="leading-none px-1">STIMA TEMPO TAGLIO</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groupedBOM.guaina.length > 0 ? groupedBOM.guaina.map((item, i) => {
                            const totalPcs = item.quantity * job.qta;
                            const totalMt = item.lunghezzaTaglioMm ? (totalPcs * item.lunghezzaTaglioMm / 1000) : 0;

                            return (
                                <tr key={i} className="border-b-2 border-black even:bg-slate-50/50 h-10">
                                    <td className="border-r-2 border-black px-2 font-black text-left text-sm">{item.component}</td>
                                    <td className="border-r-2 border-black font-mono text-xs">{item.lunghezzaTaglioMm || '---'}</td>
                                    <td className="border-r-2 border-black font-black text-sm">{totalPcs.toFixed(0)}</td>
                                    <td className="border-r-2 border-black font-black text-blue-700">{totalMt > 0 ? totalMt.toFixed(2) + ' m' : '---'}</td>
                                    <td className="border-r-2 border-black text-gray-400">| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; |</td>
                                    <td className="border-r-2 border-black text-lg">□</td>
                                    {i === 0 && (
                                        <td rowSpan={groupedBOM.guaina.length} className="p-2 bg-gray-50/50 font-black text-sm">
                                            {estimatedTimes.guaina}
                                        </td>
                                    )}
                                </tr>
                            );
                        }) : (
                            <tr className="h-10 border-b-2 border-black"><td colSpan={7} className="italic text-gray-400">Nessun componente Guaina</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Footer Notes Area */}
            <div className="grid grid-cols-2 border-2 border-black mt-auto min-h-[100px]">
                <div className="border-r-2 border-black p-3 flex flex-col">
                    <span className="font-black text-[10px] bg-orange-100 p-1 mb-2 inline-block border border-orange-200">SEGNALAZIONE OPERATORE (NOTE - NC)</span>
                    <div className="flex-1 italic text-gray-300 font-medium">Scrivere qui eventuali anomalie o osservazioni...</div>
                </div>
                <div className="p-3 flex flex-col">
                    <span className="font-black text-[10px] bg-gray-100 p-1 mb-2 inline-block border border-gray-200">DATA E FIRMA OPERATORE</span>
                    <div className="flex-1 flex items-end justify-between px-4 pb-2">
                        <span className="text-[9px] text-gray-400 font-bold">DATA: ___/___/______</span>
                        <span className="text-[9px] text-gray-400 font-bold">FIRMA: ___________________________________</span>
                    </div>
                </div>
            </div>

        </div>
        {/* --- ODL DOCUMENT END --- */}

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
          }
          .bg-blue-100 { background-color: #dbeafe !important; }
          .bg-emerald-50 { background-color: #ecfdf5 !important; }
          .bg-gray-100 { background-color: #f3f4f6 !important; }
          .bg-gray-800 { background-color: #1f2937 !important; color: white !important; }
          .bg-orange-100 { background-color: #ffedd5 !important; }
          .text-red-600 { color: #dc2626 !important; }
          .text-blue-700 { color: #1d4ed8 !important; }
          
          #odl-document {
             box-shadow: none;
             margin: 0;
             padding: 4px;
             border: 2px solid black !important;
          }
        }
      `}</style>
    </div>
  );
}


export default function ODLPrintPage() {
  return (
    <Suspense fallback={
        <div className="flex flex-col items-center justify-center h-screen gap-4 bg-background">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground animate-pulse">Caricamento...</p>
        </div>
    }>
        <PrintPageContent />
    </Suspense>
  );
}
