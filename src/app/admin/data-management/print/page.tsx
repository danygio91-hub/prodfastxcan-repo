
"use client"

import React, { useEffect, useState, Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import QRCode from 'react-qr-code';
import { Loader2, AlertCircle, Printer } from 'lucide-react';
import { getJobDetailReport } from '@/app/admin/reports/actions';
import { getArticles } from '@/app/admin/article-management/actions';
import { getRawMaterials } from '@/app/admin/raw-material-management/actions';
import { format, parseISO, isValid } from 'date-fns';
import { Button } from '@/components/ui/button';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import type { JobOrder, RawMaterial, Article, JobBillOfMaterialsItem } from '@/lib/mock-data';

function PrintPageContent() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get('jobId');
  
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

  const materialsMap = useMemo(() => new Map(materials.map(m => [m.code.toUpperCase(), m])), [materials]);

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
  
  const qrValue = `${job.ordinePF}@${job.details}@${job.qta}`;

  const formatDateSafe = (dateInput: any) => {
      if (!dateInput) return '---';
      try {
        const d = typeof dateInput === 'string' ? parseISO(dateInput) : (dateInput.toDate ? dateInput.toDate() : new Date(dateInput));
        return isValid(d) ? format(d, 'dd/MM/yyyy') : '---';
      } catch (e) { return '---'; }
  };

  return (
    <div className="min-h-screen bg-neutral-100 py-8 print:bg-white print:py-0">
       <div className="max-w-[29.7cm] mx-auto bg-white shadow-2xl print:shadow-none min-h-[21cm] p-[0.5cm]">
        
        <div className="flex justify-between items-center mb-6 print:hidden bg-slate-800 text-white p-4 rounded-lg">
            <div className="space-y-1">
                <h3 className="font-bold text-lg">Anteprima Scheda Lavorazione (ODL)</h3>
                <p className="text-xs opacity-70">Verifica i dati. La stampa è ottimizzata per A4 Orizzontale.</p>
            </div>
            <div className="flex gap-2">
                <Button variant="secondary" onClick={() => window.close()} size="sm" className="bg-slate-700 hover:bg-slate-600 text-white border-0">Chiudi</Button>
                <Button onClick={() => window.print()} size="sm"><Printer className="mr-2 h-4 w-4"/>Stampa Ora</Button>
            </div>
        </div>

        <div id="odl-document" className="text-black font-sans bg-white border-2 border-black p-4">
            
            <div className="flex justify-between items-end mb-4 px-2">
                <div className="w-32">
                    <img src="/logo.png" alt="PF" className="w-full h-auto grayscale" onError={(e) => e.currentTarget.style.display = 'none'} data-ai-hint="logo aziendale" />
                </div>
                <div className="flex-1 text-center">
                    <h1 className="text-3xl font-black underline tracking-widest mb-1">SCHEDA DI LAVORAZIONE</h1>
                </div>
                <div className="text-[10px] text-right font-bold italic leading-tight">
                    MOD. 800_5_02 REV.0 del 08/05/2024
                </div>
            </div>

            <div className="grid grid-cols-5 border-2 border-black mb-4 bg-white">
                <div className="border-r-2 border-black p-2 text-center">
                    <span className="block text-[9px] font-bold uppercase text-gray-500">Reparto</span>
                    <span className="font-bold text-sm leading-none">{job.department || 'N/D'}</span>
                </div>
                <div className="border-r-2 border-black p-2 text-center">
                    <span className="block text-[9px] font-bold uppercase text-gray-500">Data ODL</span>
                    <span className="font-bold text-sm leading-none">{formatDateSafe(job.odlCreationDate || new Date())}</span>
                </div>
                <div className="border-r-2 border-black p-2 text-center">
                    <span className="block text-[9px] font-bold uppercase text-gray-500">N° Ord. Interno</span>
                    <span className="font-bold text-sm leading-none">{job.numeroODLInterno || '---'}</span>
                </div>
                <div className="border-r-2 border-black p-2 text-center bg-[#dbeafe]">
                    <span className="block text-[9px] font-bold uppercase text-blue-800">Numero Ordine PF</span>
                    <span className="font-black text-xl leading-none">{job.ordinePF}</span>
                </div>
                <div className="p-2 text-center bg-[#ecfdf5]">
                    <span className="block text-[9px] font-bold uppercase text-emerald-800">N° ODL</span>
                    <span className="font-black text-xl text-emerald-700 leading-none">{job.numeroODL || '---'}</span>
                </div>
            </div>

            <div className="grid grid-cols-12 border-2 border-black mb-4 min-h-[220px]">
                <div className="col-span-4 border-r-2 border-black flex flex-col">
                    <div className="grid grid-cols-3 flex-1">
                        <div className="col-span-1 border-b-2 border-black p-2 font-black uppercase bg-gray-100 flex items-center text-[10px]">Cliente</div>
                        <div className="col-span-2 border-b-2 border-black p-2 flex items-center font-bold text-xs">{job.cliente}</div>
                        
                        <div className="col-span-1 border-b-2 border-black p-2 font-black uppercase bg-gray-100 flex items-center text-[10px]">Codice Articolo</div>
                        <div className="col-span-2 border-b-2 border-black p-2 flex items-center font-black text-xl tracking-tighter">{job.details}</div>
                        
                        <div className="col-span-1 border-b-2 border-black p-2 font-black uppercase bg-gray-100 flex items-center text-[10px]">Disegno</div>
                        <div className="col-span-2 border-b-2 border-black p-2 flex items-center italic text-gray-400">---</div>
                        
                        <div className="col-span-1 border-b-2 border-black p-2 font-black uppercase bg-gray-100 flex items-center text-[10px]">QT</div>
                        <div className="col-span-2 border-b-2 border-black p-2 flex items-center font-black text-3xl">{job.qta}</div>
                        
                        <div className="col-span-1 p-2 font-black uppercase bg-gray-100 flex items-center leading-none text-[9px]">Data Fine Prep. Materiale</div>
                        <div className="col-span-2 p-2 flex items-center font-black text-lg text-red-600">{formatDateSafe(job.dataConsegnaFinale)}</div>
                    </div>
                </div>
                <div className="col-span-3 border-r-2 border-black flex flex-col items-center justify-center p-4 relative bg-white">
                    <span className="absolute top-2 text-[10px] text-blue-600 font-black uppercase tracking-widest">CODICE COMMESSA</span>
                    <div className="w-full flex justify-center">
                        <QRCode value={qrValue} size={160} style={{ height: "auto", maxWidth: "100%", width: "100%" }} viewBox={`0 0 256 256`} />
                    </div>
                </div>
                <div className="col-span-5 p-4 text-center flex items-center justify-center italic bg-gray-50/30">
                    <p className="text-gray-300 text-sm font-black tracking-widest uppercase opacity-40 px-10 leading-loose">
                        SPAZIO PER DISEGNO TECNICO / NOTE AGGIUNTIVE
                    </p>
                </div>
            </div>

            <div className="bg-[#1f2937] text-white border-2 border-black p-2 text-center font-black uppercase tracking-[0.4em] mb-4 text-sm">
                PREPARAZIONE COMPONENTI COMMESSE (REPARTO MAGAZZINO)
            </div>

            <div className="mb-6">
                <table className="w-full border-collapse border-2 border-black text-center table-fixed">
                    <thead>
                        <tr className="bg-gray-100 text-[10px] font-black uppercase border-b-2 border-black h-10">
                            <th className="border-r-2 border-black w-[25%] px-2">TRECCIA/CORDA</th>
                            <th className="border-r-2 border-black w-[15%]">L TAGLIO MM (TOLL)</th>
                            <th className="border-r-2 border-black w-[10%]">QT</th>
                            <th className="border-r-2 border-black w-[15%]">VERIFICA MISURA MM</th>
                            <th className="border-r-2 border-black w-[10%]">COMPLETATO</th>
                            <th className="border-r-2 border-black w-[15%] leading-tight px-1">STIMA TEMPO TAGLIO (HH:MM)</th>
                            <th className="w-[10%]">ALERT</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groupedBOM.treccia.length > 0 ? groupedBOM.treccia.map((item, i) => (
                            <tr key={i} className="border-b-2 border-black h-12">
                                <td className="border-r-2 border-black px-2 font-black text-left text-sm">{item.component}</td>
                                <td className="border-r-2 border-black font-mono text-base">{item.lunghezzaTaglioMm || '---'}</td>
                                <td className="border-r-2 border-black font-black text-lg">{(item.quantity * job.qta).toFixed(0)}</td>
                                <td className="border-r-2 border-black text-gray-300 text-xl font-light">| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; |</td>
                                <td className="border-r-2 border-black text-2xl">□</td>
                                {i === 0 && (
                                    <td rowSpan={groupedBOM.treccia.length} className="border-r-2 border-black p-2 bg-gray-50/50 font-black text-lg">
                                        {estimatedTimes.treccia}
                                    </td>
                                )}
                                <td className="px-2 text-[9px] italic text-left leading-tight font-bold">{item.note || ''}</td>
                            </tr>
                        )) : (
                            <tr className="h-12 border-b-2 border-black"><td colSpan={7} className="italic text-gray-400">Nessun componente Treccia/Corda</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="mb-6">
                <table className="w-full border-collapse border-2 border-black text-center table-fixed">
                    <thead>
                        <tr className="bg-gray-100 text-[10px] font-black uppercase border-b-2 border-black h-10">
                            <th className="border-r-2 border-black w-[35%] px-2">CODICE TUBI</th>
                            <th className="border-r-2 border-black w-[10%]">QT (N°)</th>
                            <th className="border-r-2 border-black w-[10%]">QT (KG.)</th>
                            <th className="border-r-2 border-black w-[15%]">VERIFICA MISURE</th>
                            <th className="border-r-2 border-black w-[10%]">PRELEVATO DA MAG</th>
                            <th className="w-[20%] leading-tight px-1">STIMA TEMPO PREPARAZIONE (MINUTI)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groupedBOM.tubi.length > 0 ? groupedBOM.tubi.map((item, i) => {
                            const mat = materialsMap.get(item.component.toUpperCase());
                            const totalPcs = item.quantity * job.qta;
                            const totalKg = mat?.conversionFactor ? (totalPcs * mat.conversionFactor) : 0;
                            return (
                                <tr key={i} className="border-b-2 border-black h-12">
                                    <td className="border-r-2 border-black px-2 font-black text-left text-sm">{item.component}</td>
                                    <td className="border-r-2 border-black font-black text-lg">{totalPcs.toFixed(0)}</td>
                                    <td className="border-r-2 border-black font-mono text-sm">{totalKg > 0 ? totalKg.toFixed(2) : '---'}</td>
                                    <td className="border-r-2 border-black text-gray-300 text-xl font-light">| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; |</td>
                                    <td className="border-r-2 border-black text-2xl">□</td>
                                    {i === 0 && (
                                        <td rowSpan={groupedBOM.tubi.length} className="p-2 bg-gray-50/50 font-black text-lg">
                                            {estimatedTimes.tubi}
                                        </td>
                                    )}
                                </tr>
                            );
                        }) : (
                            <tr className="h-12 border-b-2 border-black"><td colSpan={6} className="italic text-gray-400">Nessun componente Tubi</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="mb-6">
                <table className="w-full border-collapse border-2 border-black text-center table-fixed">
                    <thead>
                        <tr className="bg-gray-100 text-[10px] font-black uppercase border-b-2 border-black h-10">
                            <th className="border-r-2 border-black w-[25%] px-2">GUAINA</th>
                            <th className="border-r-2 border-black w-[15%]">L TAGLIO MM (TOLL)</th>
                            <th className="border-r-2 border-black w-[10%]">QT</th>
                            <th className="border-r-2 border-black w-[15%]">MT. GUAINA</th>
                            <th className="border-r-2 border-black w-[15%]">VERIFICA MISURA MM</th>
                            <th className="border-r-2 border-black w-[10%]">COMPLETATO</th>
                            <th className="w-[10%] leading-tight px-1">STIMA TEMPO TAGLIO</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groupedBOM.guaina.length > 0 ? groupedBOM.guaina.map((item, i) => {
                            const totalPcs = item.quantity * job.qta;
                            const totalMt = item.lunghezzaTaglioMm ? (totalPcs * item.lunghezzaTaglioMm / 1000) : 0;
                            return (
                                <tr key={i} className="border-b-2 border-black h-12">
                                    <td className="border-r-2 border-black px-2 font-black text-left text-sm">{item.component}</td>
                                    <td className="border-r-2 border-black font-mono text-base">{item.lunghezzaTaglioMm || '---'}</td>
                                    <td className="border-r-2 border-black font-black text-lg">{totalPcs.toFixed(0)}</td>
                                    <td className="border-r-2 border-black font-black text-blue-700 text-base">{totalMt > 0 ? totalMt.toFixed(2) + ' m' : '---'}</td>
                                    <td className="border-r-2 border-black text-gray-300 text-xl font-light">| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; |</td>
                                    <td className="border-r-2 border-black text-2xl">□</td>
                                    {i === 0 && (
                                        <td rowSpan={groupedBOM.guaina.length} className="p-2 bg-gray-50/50 font-black text-sm">
                                            {estimatedTimes.guaina}
                                        </td>
                                    )}
                                </tr>
                            );
                        }) : (
                            <tr className="h-12 border-b-2 border-black"><td colSpan={7} className="italic text-gray-400">Nessun componente Guaina</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="grid grid-cols-2 border-2 border-black min-h-[130px]">
                <div className="border-r-2 border-black p-3 flex flex-col bg-white">
                    <span className="font-black text-[11px] bg-orange-100 p-1 mb-2 inline-block border border-orange-300 w-fit">SEGNALAZIONE OPERATORE (NOTE - NC)</span>
                    <div className="flex-1 italic text-gray-200 font-bold text-xs">Annotazioni per anomalie o NC riscontrate...</div>
                </div>
                <div className="p-3 flex flex-col bg-white">
                    <span className="font-black text-[11px] bg-gray-100 p-1 mb-2 inline-block border border-gray-300 w-fit">DATA E FIRMA OPERATORE</span>
                    <div className="flex-1 flex items-end justify-between px-4 pb-2">
                        <span className="text-[10px] text-gray-400 font-black">DATA: ___/___/______</span>
                        <span className="text-[10px] text-gray-400 font-black">FIRMA: ___________________________________</span>
                    </div>
                </div>
            </div>

        </div>
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
          #odl-document {
             box-shadow: none;
             margin: 0;
             padding: 10px;
             border: 2px solid black !important;
          }
          .bg-blue-100, .bg-[#dbeafe] { background-color: #dbeafe !important; }
          .bg-emerald-50, .bg-[#ecfdf5] { background-color: #ecfdf5 !important; }
          .bg-gray-100 { background-color: #f3f4f6 !important; }
          .bg-[#1f2937] { background-color: #1f2937 !important; color: white !important; }
          .bg-orange-100 { background-color: #ffedd5 !important; }
          .text-red-600 { color: #dc2626 !important; }
          .text-blue-700 { color: #1d4ed8 !important; }
          .text-blue-800 { color: #1e40af !important; }
          .text-emerald-800 { color: #065f46 !important; }
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
