
"use client";

import React from 'react';
import QRCode from 'react-qr-code';
import { format, isValid, parseISO } from 'date-fns';
import type { JobOrder, RawMaterial, Article, JobBillOfMaterialsItem } from '@/lib/mock-data';

interface ODLPrintTemplateProps {
  job: JobOrder;
  article: Article | null;
  materials: RawMaterial[];
}

export default function ODLPrintTemplate({ job, article, materials }: ODLPrintTemplateProps) {
  const materialsMap = new Map(materials.map(m => [m.code.toUpperCase(), m]));

  const groupedBOM = (() => {
    const treccia: JobBillOfMaterialsItem[] = [];
    const tubi: JobBillOfMaterialsItem[] = [];
    const guaina: JobBillOfMaterialsItem[] = [];

    (job.billOfMaterials || []).forEach(item => {
      const mat = materialsMap.get(item.component.toUpperCase());
      const type = mat?.type;
      if (type === 'TUBI') tubi.push(item);
      else if (type === 'GUAINA') guaina.push(item);
      else treccia.push(item);
    });

    return { treccia, tubi, guaina };
  })();

  const estimatedTimes = (() => {
    if (!article?.phaseTimes) return { treccia: 'N/D', tubi: 'N/D', guaina: 'N/D' };
    const formatMins = (mins: number) => {
        if (!mins || mins <= 0) return 'N/D';
        const totalMins = mins * job.qta;
        const h = Math.floor(totalMins / 60);
        const m = Math.round(totalMins % 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };
    return {
      treccia: formatMins(article.phaseTimes['phase-template-1']?.expectedMinutesPerPiece || 0),
      tubi: formatMins(article.phaseTimes['phase-template-7']?.expectedMinutesPerPiece || 0),
      guaina: formatMins(article.phaseTimes['phase-template-6']?.expectedMinutesPerPiece || 0)
    };
  })();

  const formatDateSafe = (dateInput: any) => {
      if (!dateInput) return '---';
      try {
        const d = typeof dateInput === 'string' ? parseISO(dateInput) : (dateInput.toDate ? dateInput.toDate() : new Date(dateInput));
        return isValid(d) ? format(d, 'dd/MM/yyyy') : '---';
      } catch (e) { return '---'; }
  };

  const qrValue = `${job.ordinePF}@${job.details}@${job.qta}`;

  return (
    <div id="odl-pdf-content" className="w-[297mm] min-h-[210mm] p-4 bg-white text-black font-sans border-[3px] border-black" style={{ position: 'absolute', top: '-9999px', left: '-9999px', transform: 'scale(1)', transformOrigin: 'top left' }}>
        <div className="flex justify-between items-end mb-4 px-2">
            <div className="w-32">
                <img src="/logo.png" alt="PF" className="w-full h-auto grayscale" />
            </div>
            <div className="flex-1 text-center">
                <h1 className="text-4xl font-black underline tracking-widest mb-1">SCHEDA DI LAVORAZIONE</h1>
            </div>
            <div className="text-[10px] text-right font-bold italic leading-tight">
                MOD. 800_5_02 REV.0 del 08/05/2024
            </div>
        </div>

        <div className="grid grid-cols-5 border-2 border-black mb-4 bg-white">
            <div className="border-r-2 border-black p-2 text-center">
                <span className="block text-[10px] font-bold uppercase text-gray-500">Reparto</span>
                <span className="font-bold text-base">{job.department || 'N/D'}</span>
            </div>
            <div className="border-r-2 border-black p-2 text-center">
                <span className="block text-[10px] font-bold uppercase text-gray-500">Data ODL</span>
                <span className="font-bold text-base">{formatDateSafe(job.odlCreationDate || new Date())}</span>
            </div>
            <div className="border-r-2 border-black p-2 text-center">
                <span className="block text-[10px] font-bold uppercase text-gray-500">N° Ord. Interno</span>
                <span className="font-bold text-base">{job.numeroODLInterno || '---'}</span>
            </div>
            <div className="border-r-2 border-black p-2 text-center bg-[#dbeafe]">
                <span className="block text-[10px] font-bold uppercase text-blue-800">Numero Ordine PF</span>
                <span className="font-black text-2xl">{job.ordinePF}</span>
            </div>
            <div className="p-2 text-center bg-[#ecfdf5]">
                <span className="block text-[10px] font-bold uppercase text-emerald-800">N° ODL</span>
                <span className="font-black text-2xl text-emerald-700">{job.numeroODL || '---'}</span>
            </div>
        </div>

        <div className="grid grid-cols-12 border-2 border-black mb-4 min-h-[220px]">
            <div className="col-span-4 border-r-2 border-black flex flex-col">
                <div className="grid grid-cols-3 flex-1">
                    <div className="col-span-1 border-b-2 border-black p-2 font-black uppercase bg-gray-100 flex items-center text-[11px]">Cliente</div>
                    <div className="col-span-2 border-b-2 border-black p-2 flex items-center font-bold text-sm">{job.cliente}</div>
                    
                    <div className="col-span-1 border-b-2 border-black p-2 font-black uppercase bg-gray-100 flex items-center text-[11px]">Codice Articolo</div>
                    <div className="col-span-2 border-b-2 border-black p-2 flex items-center font-black text-2xl tracking-tighter">{job.details}</div>
                    
                    <div className="col-span-1 border-b-2 border-black p-2 font-black uppercase bg-gray-100 flex items-center text-[11px]">Disegno</div>
                    <div className="col-span-2 border-b-2 border-black p-2 flex items-center italic text-gray-400">---</div>
                    
                    <div className="col-span-1 border-b-2 border-black p-2 font-black uppercase bg-gray-100 flex items-center text-[11px]">QT</div>
                    <div className="col-span-2 border-b-2 border-black p-2 flex items-center font-black text-4xl">{job.qta}</div>
                    
                    <div className="col-span-1 p-2 font-black uppercase bg-gray-100 flex items-center leading-none text-[10px]">Data Fine Prep. Materiale</div>
                    <div className="col-span-2 p-2 flex items-center font-black text-xl text-red-600">{formatDateSafe(job.dataConsegnaFinale)}</div>
                </div>
            </div>
            <div className="col-span-3 border-r-2 border-black flex flex-col items-center justify-center p-4 relative bg-white">
                <span className="absolute top-2 text-[11px] text-blue-600 font-black uppercase tracking-widest">CODICE COMMESSA</span>
                <div className="w-full flex justify-center">
                    <QRCode value={qrValue} size={180} />
                </div>
            </div>
            <div className="col-span-5 p-4 text-center flex items-center justify-center italic bg-gray-50/30">
                <p className="text-gray-300 text-lg font-black tracking-widest uppercase opacity-40 px-10 leading-loose">
                    SPAZIO PER DISEGNO TECNICO / NOTE AGGIUNTIVE
                </p>
            </div>
        </div>

        <div className="bg-[#1f2937] text-white border-2 border-black p-2 text-center font-black uppercase tracking-[0.4em] mb-4 text-sm">
            PREPARAZIONE COMPONENTI COMMESSE (REPARTO MAGAZZINO)
        </div>

        <table className="w-full border-collapse border-2 border-black text-center table-fixed mb-4">
            <thead>
                <tr className="bg-gray-100 text-[11px] font-black uppercase border-b-2 border-black h-10">
                    <th className="border-r-2 border-black w-[25%]">TRECCIA/CORDA</th>
                    <th className="border-r-2 border-black w-[15%]">L TAGLIO MM</th>
                    <th className="border-r-2 border-black w-[10%]">QT</th>
                    <th className="border-r-2 border-black w-[15%]">VERIFICA MISURA</th>
                    <th className="border-r-2 border-black w-[10%]">COMPLETATO</th>
                    <th className="border-r-2 border-black w-[15%]">STIMA TEMPO</th>
                    <th className="w-[10%]">ALERT</th>
                </tr>
            </thead>
            <tbody>
                {groupedBOM.treccia.map((item, i) => (
                    <tr key={i} className="border-b-2 border-black h-12">
                        <td className="border-r-2 border-black px-2 font-black text-left text-sm">{item.component}</td>
                        <td className="border-r-2 border-black font-mono text-base">{item.lunghezzaTaglioMm || '---'}</td>
                        <td className="border-r-2 border-black font-black text-xl">{(item.quantity * job.qta).toFixed(0)}</td>
                        <td className="border-r-2 border-black text-gray-300 text-2xl">| &nbsp;&nbsp;&nbsp; |</td>
                        <td className="border-r-2 border-black text-3xl">□</td>
                        {i === 0 && <td rowSpan={groupedBOM.treccia.length} className="border-r-2 border-black font-black text-lg bg-gray-50">{estimatedTimes.treccia}</td>}
                        <td className="px-2 text-[10px] font-bold">{item.note || ''}</td>
                    </tr>
                ))}
            </tbody>
        </table>

        <table className="w-full border-collapse border-2 border-black text-center table-fixed mb-4">
            <thead>
                <tr className="bg-gray-100 text-[11px] font-black uppercase border-b-2 border-black h-10">
                    <th className="border-r-2 border-black w-[35%]">CODICE TUBI</th>
                    <th className="border-r-2 border-black w-[10%]">QT (N°)</th>
                    <th className="border-r-2 border-black w-[10%]">QT (KG.)</th>
                    <th className="border-r-2 border-black w-[15%]">VERIFICA MISURE</th>
                    <th className="border-r-2 border-black w-[10%]">PRELEVATO</th>
                    <th className="w-[20%]">STIMA TEMPO</th>
                </tr>
            </thead>
            <tbody>
                {groupedBOM.tubi.map((item, i) => {
                    const mat = materialsMap.get(item.component.toUpperCase());
                    const totalPcs = item.quantity * job.qta;
                    const totalKg = mat?.conversionFactor ? (totalPcs * mat.conversionFactor) : 0;
                    return (
                        <tr key={i} className="border-b-2 border-black h-12">
                            <td className="border-r-2 border-black px-2 font-black text-left text-sm">{item.component}</td>
                            <td className="border-r-2 border-black font-black text-xl">{totalPcs.toFixed(0)}</td>
                            <td className="border-r-2 border-black font-mono text-sm">{totalKg > 0 ? totalKg.toFixed(2) : '---'}</td>
                            <td className="border-r-2 border-black text-gray-300 text-2xl">| &nbsp;&nbsp;&nbsp; |</td>
                            <td className="border-r-2 border-black text-3xl">□</td>
                            {i === 0 && <td rowSpan={groupedBOM.tubi.length} className="font-black text-lg bg-gray-50">{estimatedTimes.tubi}</td>}
                        </tr>
                    );
                })}
            </tbody>
        </table>

        <table className="w-full border-collapse border-2 border-black text-center table-fixed mb-6">
            <thead>
                <tr className="bg-gray-100 text-[11px] font-black uppercase border-b-2 border-black h-10">
                    <th className="border-r-2 border-black w-[25%]">GUAINA</th>
                    <th className="border-r-2 border-black w-[15%]">L TAGLIO MM</th>
                    <th className="border-r-2 border-black w-[10%]">QT</th>
                    <th className="border-r-2 border-black w-[15%]">MT. GUAINA</th>
                    <th className="border-r-2 border-black w-[15%]">VERIFICA MISURA</th>
                    <th className="border-r-2 border-black w-[10%]">COMPLETATO</th>
                    <th className="w-[10%]">STIMA TEMPO</th>
                </tr>
            </thead>
            <tbody>
                {groupedBOM.guaina.map((item, i) => {
                    const totalPcs = item.quantity * job.qta;
                    const totalMt = item.lunghezzaTaglioMm ? (totalPcs * item.lunghezzaTaglioMm / 1000) : 0;
                    return (
                        <tr key={i} className="border-b-2 border-black h-12">
                            <td className="border-r-2 border-black px-2 font-black text-left text-sm">{item.component}</td>
                            <td className="border-r-2 border-black font-mono text-base">{item.lunghezzaTaglioMm || '---'}</td>
                            <td className="border-r-2 border-black font-black text-xl">{totalPcs.toFixed(0)}</td>
                            <td className="border-r-2 border-black font-black text-blue-700 text-base">{totalMt > 0 ? totalMt.toFixed(2) + ' m' : '---'}</td>
                            <td className="border-r-2 border-black text-gray-300 text-2xl">| &nbsp;&nbsp;&nbsp; |</td>
                            <td className="border-r-2 border-black text-3xl">□</td>
                            {i === 0 && <td rowSpan={groupedBOM.guaina.length} className="font-black text-sm bg-gray-50">{estimatedTimes.guaina}</td>}
                        </tr>
                    );
                })}
            </tbody>
        </table>

        <div className="grid grid-cols-2 border-2 border-black min-h-[130px]">
            <div className="border-r-2 border-black p-3 flex flex-col bg-white">
                <span className="font-black text-[12px] bg-orange-100 p-1 mb-2 inline-block border border-orange-300 w-fit">SEGNALAZIONE OPERATORE</span>
                <div className="flex-1 italic text-gray-200 font-bold text-xs">Annotazioni...</div>
            </div>
            <div className="p-3 flex flex-col bg-white">
                <span className="font-black text-[12px] bg-gray-100 p-1 mb-2 inline-block border border-gray-300 w-fit">DATA E FIRMA</span>
                <div className="flex-1 flex items-end justify-between px-4 pb-2">
                    <span className="text-[11px] text-gray-400 font-black">DATA: ___/___/______</span>
                    <span className="text-[11px] text-gray-400 font-black">FIRMA: _____________________________</span>
                </div>
            </div>
        </div>
    </div>
  );
}
