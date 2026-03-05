
"use client"

import type { JobOrder, RawMaterial, Article, JobBillOfMaterialsItem } from '@/lib/mock-data';
import { notFound, useSearchParams } from 'next/navigation';
import QRCode from 'react-qr-code';
import { PrintButton } from './PrintButton';
import { useEffect, useState, Suspense, useMemo } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { getJobDetailReport } from '@/app/admin/reports/actions';
import { getArticles } from '@/app/admin/article-management/actions';
import { getRawMaterials } from '@/app/admin/raw-material-management/actions';
import { formatDisplayStock } from '@/lib/utils';
import { cn } from '@/lib/utils';

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
        setError('Errore nel caricamento dei dati.');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [jobId]);

  const materialsMap = useMemo(() => new Map(materials.map(m => [m.code.toUpperCase(), m])), [materials]);

  // Suddivisione componenti per tipologia
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
        // BOB, BARRA, PF3V0 o Default
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
        return `${h > 0 ? h + 'h ' : ''}${m}m`;
    };

    // Mapping nomi fasi standard per recuperare i tempi previsti
    const trecciaTime = Object.values(article.phaseTimes).find((_, i) => Object.keys(article.phaseTimes!)[i].includes('phase-template-1'))?.expectedMinutesPerPiece || 0;
    const tubiTime = Object.values(article.phaseTimes).find((_, i) => Object.keys(article.phaseTimes!)[i].includes('phase-template-7'))?.expectedMinutesPerPiece || 0;
    const guainaTime = Object.values(article.phaseTimes).find((_, i) => Object.keys(article.phaseTimes!)[i].includes('phase-template-6'))?.expectedMinutesPerPiece || 0;

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
            <p className="text-muted-foreground animate-pulse">Generazione Scheda di Lavorazione...</p>
        </div>
    );
  }
  
  if (error || !job) {
    return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-4 text-center">
            <AlertCircle className="h-16 w-16 text-destructive" />
            <h1 className="text-2xl font-bold">{error || 'Errore critico'}</h1>
            <Button onClick={() => window.close()}>Chiudi Finestra</Button>
        </div>
    );
  }
  
  const qrValue = `${job.ordinePF}@${job.details}@${job.qta}`;

  return (
    <div className="min-h-screen bg-neutral-100 py-8 print:bg-white print:py-0">
       <div className="max-w-[21cm] mx-auto bg-white shadow-2xl print:shadow-none min-h-[29.7cm] p-[1cm]">
        
        {/* Print Controls */}
        <div className="flex justify-between items-center mb-6 print:hidden bg-muted p-4 rounded-lg border border-border">
            <div className="space-y-1">
                <h3 className="font-bold">Anteprima di Stampa A4</h3>
                <p className="text-xs text-muted-foreground">Verifica che i margini siano impostati su "Nessuno" o "Predefiniti" nelle impostazioni del browser.</p>
            </div>
            <PrintButton />
        </div>

        {/* --- ODL DOCUMENT START --- */}
        <div id="odl-document" className="text-[11px] leading-tight font-sans text-black">
            
            {/* Header Module Info */}
            <div className="flex justify-between items-center border-b border-black pb-1 mb-2">
                <div className="w-16">
                    <img src="/logo.png" alt="PF" className="w-full h-auto grayscale" />
                </div>
                <div className="flex-1 text-center">
                    <h1 className="text-lg font-bold underline">SCHEDA DI LAVORAZIONE</h1>
                </div>
                <div className="text-[9px] text-right font-mono">
                    MOD. 800_5_02 REV.0 del 08/05/2024
                </div>
            </div>

            {/* Top Grid Info */}
            <div className="grid grid-cols-5 border border-black mb-2">
                <div className="border-r border-black p-1 text-center bg-gray-50">
                    <span className="block text-[8px] font-bold uppercase">Reparto</span>
                    <span className="font-semibold">{job.department}</span>
                </div>
                <div className="border-r border-black p-1 text-center bg-gray-50">
                    <span className="block text-[8px] font-bold uppercase">Data ODL</span>
                    <span className="font-semibold">{job.odlCreationDate ? format(new Date(job.odlCreationDate), 'dd/MM/yyyy') : format(new Date(), 'dd/MM/yyyy')}</span>
                </div>
                <div className="border-r border-black p-1 text-center bg-gray-50">
                    <span className="block text-[8px] font-bold uppercase">N° Ord. Interno</span>
                    <span className="font-semibold">{job.numeroODLInterno || '---'}</span>
                </div>
                <div className="border-r border-black p-1 text-center bg-blue-100">
                    <span className="block text-[8px] font-bold uppercase">Numero Ordine PF</span>
                    <span className="font-bold text-sm">{job.ordinePF}</span>
                </div>
                <div className="p-1 text-center bg-green-50">
                    <span className="block text-[8px] font-bold uppercase">N° ODL</span>
                    <span className="font-semibold">{job.numeroODL || '---'}</span>
                </div>
            </div>

            {/* Main Info Area */}
            <div className="grid grid-cols-12 gap-0 border border-black border-t-0 mb-4 h-48">
                <div className="col-span-4 border-r border-black flex flex-col">
                    {/* Labels Column */}
                    <div className="grid grid-cols-3 flex-1">
                        <div className="col-span-1 border-b border-black p-2 font-bold uppercase bg-gray-100 flex items-center">Cliente</div>
                        <div className="col-span-2 border-b border-black p-2 flex items-center font-semibold">{job.cliente}</div>
                        
                        <div className="col-span-1 border-b border-black p-2 font-bold uppercase bg-gray-100 flex items-center">Codice Articolo</div>
                        <div className="col-span-2 border-b border-black p-2 flex items-center font-bold text-sm">{job.details}</div>
                        
                        <div className="col-span-1 border-b border-black p-2 font-bold uppercase bg-gray-100 flex items-center">Disegno</div>
                        <div className="col-span-2 border-b border-black p-2 flex items-center italic text-muted-foreground">---</div>
                        
                        <div className="col-span-1 border-b border-black p-2 font-bold uppercase bg-gray-100 flex items-center">QT</div>
                        <div className="col-span-2 border-b border-black p-2 flex items-center font-bold text-lg">{job.qta}</div>
                        
                        <div className="col-span-1 p-2 font-bold uppercase bg-gray-100 flex items-center leading-none text-[9px]">Data Fine Prep. Materiale</div>
                        <div className="col-span-2 p-2 flex items-center font-semibold text-destructive">{job.dataConsegnaFinale ? format(parseISO(job.dataConsegnaFinale), 'dd/MM/yyyy') : '---'}</div>
                    </div>
                </div>
                <div className="col-span-2 border-r border-black flex flex-col items-center justify-center p-2 relative">
                    <span className="absolute top-1 text-[8px] text-blue-600 font-bold uppercase">Codice Commessa</span>
                    <QRCode value={qrValue} size={100} style={{ height: "auto", maxWidth: "100%", width: "100%" }} viewBox={`0 0 256 256`} />
                </div>
                <div className="col-span-6 p-4 text-center flex items-center justify-center border-l border-black">
                    <p className="text-gray-300 text-xs italic">SPAZIO PER DISEGNO TECNICO / NOTE AGGIUNTIVE</p>
                </div>
            </div>

            {/* Preparation Section Header */}
            <div className="bg-gray-100 border border-black p-1 text-center font-bold uppercase tracking-widest mb-2">
                PREPARAZIONE COMPONENTI COMMESSE (REPARTO MAGAZZINO)
            </div>

            {/* --- TABLE 1: TRECCIA / CORDA --- */}
            <div className="mb-4 break-inside-avoid">
                <table className="w-full border-collapse border border-black text-center">
                    <thead>
                        <tr className="bg-gray-50 text-[9px] font-bold uppercase border-b border-black">
                            <th className="border-r border-black p-1 w-[25%]">TRECCIA/CORDA</th>
                            <th className="border-r border-black p-1 w-[15%]">L TAGLIO mm (Toll)</th>
                            <th className="border-r border-black p-1 w-[10%]">QT</th>
                            <th className="border-r border-black p-1 w-[15%]">Verifica misura mm</th>
                            <th className="border-r border-black p-1 w-[8%]">Completato</th>
                            <th className="border-r border-black p-1 w-[12%] leading-none">Stima tempo taglio (hh:mm)</th>
                            <th className="p-1">ALERT</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groupedBOM.treccia.length > 0 ? groupedBOM.treccia.map((item, i) => (
                            <tr key={i} className="border-b border-black even:bg-neutral-50 h-8">
                                <td className="border-r border-black p-1 font-bold text-left">{item.component}</td>
                                <td className="border-r border-black p-1 font-mono">{item.lunghezzaTaglioMm || '---'}</td>
                                <td className="border-r border-black p-1 font-bold">{(item.quantity * job.qta).toFixed(0)}</td>
                                <td className="border-r border-black p-1">| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; |</td>
                                <td className="border-r border-black p-1">□</td>
                                {i === 0 && (
                                    <td rowSpan={groupedBOM.treccia.length} className="border-r border-black p-2 bg-gray-50/50 font-mono text-xs">
                                        {estimatedTimes.treccia}
                                    </td>
                                )}
                                <td className="p-1 text-[9px] italic text-left">{item.note || ''}</td>
                            </tr>
                        )) : (
                            <tr className="h-8"><td colSpan={7} className="italic text-gray-400">Nessun componente Treccia/Corda</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* --- TABLE 2: CODICE TUBI --- */}
            <div className="mb-4 break-inside-avoid">
                <table className="w-full border-collapse border border-black text-center">
                    <thead>
                        <tr className="bg-gray-50 text-[9px] font-bold uppercase border-b border-black">
                            <th className="border-r border-black p-1 w-[25%]">CODICE TUBI</th>
                            <th className="border-r border-black p-1 w-[15%]">QT (n°)</th>
                            <th className="border-r border-black p-1 w-[15%]">QT (kg.)</th>
                            <th className="border-r border-black p-1 w-[15%]">Verifica misure</th>
                            <th className="border-r border-black p-1 w-[10%] leading-none">Prelevato da mag</th>
                            <th className="p-1 leading-none">Stima tempo preparazione (minuti)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groupedBOM.tubi.length > 0 ? groupedBOM.tubi.map((item, i) => {
                            const mat = materialsMap.get(item.component.toUpperCase());
                            const totalPcs = item.quantity * job.qta;
                            const totalKg = mat?.conversionFactor ? (totalPcs * mat.conversionFactor) : 0;
                            
                            return (
                                <tr key={i} className="border-b border-black even:bg-neutral-50 h-8">
                                    <td className="border-r border-black p-1 font-bold text-left">{item.component}</td>
                                    <td className="border-r border-black p-1 font-bold">{totalPcs.toFixed(0)}</td>
                                    <td className="border-r border-black p-1 font-mono">{totalKg > 0 ? totalKg.toFixed(2) : '---'}</td>
                                    <td className="border-r border-black p-1">| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; |</td>
                                    <td className="border-r border-black p-1">□</td>
                                    {i === 0 && (
                                        <td rowSpan={groupedBOM.tubi.length} className="p-2 bg-gray-50/50 font-mono text-xs">
                                            {estimatedTimes.tubi}
                                        </td>
                                    )}
                                </tr>
                            );
                        }) : (
                            <tr className="h-8"><td colSpan={6} className="italic text-gray-400">Nessun componente Tubi</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* --- TABLE 3: GUAINA --- */}
            <div className="mb-4 break-inside-avoid">
                <table className="w-full border-collapse border border-black text-center">
                    <thead>
                        <tr className="bg-gray-50 text-[9px] font-bold uppercase border-b border-black">
                            <th className="border-r border-black p-1 w-[20%]">GUAINA</th>
                            <th className="border-r border-black p-1 w-[15%]">L TAGLIO mm (Toll)</th>
                            <th className="border-r border-black p-1 w-[10%]">QT</th>
                            <th className="border-r border-black p-1 w-[15%]">Mt. Guaina</th>
                            <th className="border-r border-black p-1 w-[15%]">Verifica misura mm</th>
                            <th className="border-r border-black p-1 w-[8%]">Completato</th>
                            <th className="p-1 leading-none">Stima tempo taglio</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groupedBOM.guaina.length > 0 ? groupedBOM.guaina.map((item, i) => {
                            const totalPcs = item.quantity * job.qta;
                            const totalMt = item.lunghezzaTaglioMm ? (totalPcs * item.lunghezzaTaglioMm / 1000) : 0;

                            return (
                                <tr key={i} className="border-b border-black even:bg-neutral-50 h-8">
                                    <td className="border-r border-black p-1 font-bold text-left">{item.component}</td>
                                    <td className="border-r border-black p-1 font-mono">{item.lunghezzaTaglioMm || '---'}</td>
                                    <td className="border-r border-black p-1 font-bold">{totalPcs.toFixed(0)}</td>
                                    <td className="border-r border-black p-1 font-mono font-bold text-blue-700">{totalMt > 0 ? totalMt.toFixed(2) + ' m' : '---'}</td>
                                    <td className="border-r border-black p-1">| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; |</td>
                                    <td className="border-r border-black p-1">□</td>
                                    {i === 0 && (
                                        <td rowSpan={groupedBOM.guaina.length} className="p-2 bg-gray-50/50 font-mono text-xs">
                                            {estimatedTimes.guaina}
                                        </td>
                                    )}
                                </tr>
                            );
                        }) : (
                            <tr className="h-8"><td colSpan={7} className="italic text-gray-400">Nessun componente Guaina</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Footer Notes Area */}
            <div className="grid grid-cols-2 border border-black mt-auto h-24">
                <div className="border-r border-black p-2 flex flex-col">
                    <span className="font-bold text-[9px] bg-orange-100 p-1 mb-1">Segnalazione Operatore (note - NC)</span>
                    <div className="flex-1 italic text-gray-300">Spazio note da tenere per compilazione manuale dell'operatore...</div>
                </div>
                <div className="p-2 flex flex-col">
                    <span className="font-bold text-[9px] bg-gray-100 p-1 mb-1">Data e Firma Operatore</span>
                    <div className="flex-1 flex items-end justify-between px-4 pb-2">
                        <span className="text-[8px] text-gray-400">DATA: ___/___/______</span>
                        <span className="text-[8px] text-gray-400">FIRMA: _________________________</span>
                    </div>
                </div>
            </div>

        </div>
        {/* --- ODL DOCUMENT END --- */}

      </div>

       <style jsx global>{`
        @page {
          size: A4;
          margin: 0;
        }
        @media print {
          body {
            background-color: white !important;
            -webkit-print-color-adjust: exact;
          }
          .bg-blue-100 { background-color: #dbeafe !important; }
          .bg-gray-100 { background-color: #f3f4f6 !important; }
          .bg-gray-50 { background-color: #f9fafb !important; }
          .bg-orange-100 { background-color: #ffedd5 !important; }
          .bg-green-50 { background-color: #f0fdf4 !important; }
          
          #printable-area {
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
        <div className="flex flex-col items-center justify-center h-screen gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground animate-pulse">Caricamento scheda...</p>
        </div>
    }>
        <PrintPageContent />
    </Suspense>
  );
}
