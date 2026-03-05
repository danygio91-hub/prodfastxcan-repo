
"use client";

import React from 'react';
import QRCode from 'react-qr-code';
import { format, isValid, parseISO } from 'date-fns';
import type { JobOrder, RawMaterial, Article, JobBillOfMaterialsItem } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

interface ODLPrintTemplateProps {
  job: JobOrder;
  article: Article | null;
  materials: RawMaterial[];
}

// Costanti per il dimensionamento A4 Landscape (in mm convertiti in approssimazione px per rendering)
const PAGE_WIDTH = "297mm";
const PAGE_HEIGHT = "210mm";

export default function ODLPrintTemplate({ job, article, materials }: ODLPrintTemplateProps) {
  const materialsMap = new Map(materials.map(m => [m.code.toUpperCase(), m]));

  // Suddivisione dei materiali per categoria
  const allItems = (job.billOfMaterials || []).map(item => {
    const mat = materialsMap.get(item.component.toUpperCase());
    const type = mat?.type || 'OTHER';
    let category: 'treccia' | 'tubi' | 'guaina' = 'treccia';
    if (type === 'TUBI') category = 'tubi';
    else if (type === 'GUAINA') category = 'guaina';
    return { ...item, category, mat };
  });

  // Logica di paginazione: raggruppiamo gli item in chunk (es. 12 per pagina per stare sicuri)
  const ITEMS_PER_PAGE = 12;
  const pages: any[][] = [];
  for (let i = 0; i < allItems.length; i += ITEMS_PER_PAGE) {
    pages.push(allItems.slice(i, i + ITEMS_PER_PAGE));
  }

  // Se non ci sono item, mostriamo comunque una pagina vuota
  if (pages.length === 0) pages.push([]);

  const formatDateSafe = (dateInput: any) => {
      if (!dateInput) return '---';
      try {
        const d = typeof dateInput === 'string' ? parseISO(dateInput) : (dateInput.toDate ? dateInput.toDate() : new Date(dateInput));
        return isValid(d) ? format(d, 'dd/MM/yyyy') : '---';
      } catch (e) { return '---'; }
  };

  const getEstimatedTime = (category: string) => {
    if (!article?.phaseTimes) return 'N/D';
    let phaseId = '';
    if (category === 'treccia') phaseId = 'phase-template-1';
    else if (category === 'tubi') phaseId = 'phase-template-7';
    else if (category === 'guaina') phaseId = 'phase-template-6';
    
    const mins = article.phaseTimes[phaseId]?.expectedMinutesPerPiece || 0;
    if (mins <= 0) return 'N/D';
    const totalMins = mins * job.qta;
    const h = Math.floor(totalMins / 60);
    const m = Math.round(totalMins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div id="odl-pdf-pages" className="bg-gray-200 p-8 flex flex-col gap-8 items-center" style={{ position: 'absolute', top: '-20000px', left: '-20000px' }}>
      {pages.map((pageItems, pageIdx) => (
        <div 
          key={pageIdx} 
          className="odl-page bg-white text-black shadow-xl relative overflow-hidden flex flex-col"
          style={{ 
            width: PAGE_WIDTH, 
            height: PAGE_HEIGHT, 
            padding: '8mm',
            boxSizing: 'border-box',
            fontFamily: 'sans-serif' 
          }}
        >
          {/* HEADER MINISTERIALE */}
          <div className="flex justify-between items-start mb-2 border-b-2 border-black pb-1">
            <div className="flex items-center gap-3">
                <img src="/logo.png" alt="PF" className="h-8 w-auto grayscale" />
                <div className="text-[8px] font-bold uppercase leading-tight opacity-50">
                    Power Flex S.r.l.<br/>Manufacturing Solutions
                </div>
            </div>
            <div className="text-center flex-1">
                <h1 className="text-xl font-black tracking-widest underline">SCHEDA DI LAVORAZIONE</h1>
            </div>
            <div className="text-[7px] text-right font-bold italic">
                MOD. 800_5_02 REV.0 del 08/05/2024 - Pag. {pageIdx + 1}/{pages.length}
            </div>
          </div>

          {/* GRID INFORMAZIONI PRINCIPALI */}
          <div className="grid grid-cols-5 border-2 border-black mb-2 bg-white text-[9px]">
            <div className="border-r-2 border-black p-1 text-center">
                <span className="block text-[7px] font-bold uppercase text-gray-500">Reparto</span>
                <span className="font-bold truncate block">{job.department || 'N/D'}</span>
            </div>
            <div className="border-r-2 border-black p-1 text-center">
                <span className="block text-[7px] font-bold uppercase text-gray-500">Data ODL</span>
                <span className="font-bold">{formatDateSafe(job.odlCreationDate || new Date())}</span>
            </div>
            <div className="border-r-2 border-black p-1 text-center">
                <span className="block text-[7px] font-bold uppercase text-gray-500">N° Ord. Interno</span>
                <span className="font-bold">{job.numeroODLInterno || '---'}</span>
            </div>
            <div className="border-r-2 border-black p-1 text-center bg-[#dbeafe]">
                <span className="block text-[7px] font-bold uppercase text-blue-800">Ordine PF</span>
                <span className="font-black text-xs">{job.ordinePF}</span>
            </div>
            <div className="p-1 text-center bg-[#ecfdf5]">
                <span className="block text-[7px] font-bold uppercase text-emerald-800">N° ODL</span>
                <span className="font-black text-xs text-emerald-700">{job.numeroODL || '---'}</span>
            </div>
          </div>

          {/* CORPO CENTRALE: DATI E QR */}
          <div className="grid grid-cols-12 border-2 border-black mb-2 flex-grow max-h-[140px]">
            <div className="col-span-4 border-r-2 border-black flex flex-col text-[10px]">
                <div className="grid grid-cols-3 flex-1 border-b">
                    <div className="col-span-1 p-1 font-bold uppercase bg-gray-50 border-r border-b">Cliente</div>
                    <div className="col-span-2 p-1 border-b truncate font-medium">{job.cliente}</div>
                    
                    <div className="col-span-1 p-1 font-bold uppercase bg-gray-50 border-r border-b">Articolo</div>
                    <div className="col-span-2 p-1 border-b font-black text-sm tracking-tighter">{job.details}</div>
                    
                    <div className="col-span-1 p-1 font-bold uppercase bg-gray-50 border-r border-b">Disegno</div>
                    <div className="col-span-2 p-1 border-b italic text-gray-400">---</div>
                    
                    <div className="col-span-1 p-1 font-bold uppercase bg-gray-50 border-r border-b">Quantità</div>
                    <div className="col-span-2 p-1 border-b font-black text-xl">{job.qta}</div>
                    
                    <div className="col-span-1 p-1 font-bold uppercase bg-gray-50 border-r text-[8px] leading-tight">Fine Prep.</div>
                    <div className="col-span-2 p-1 font-bold text-red-600">{formatDateSafe(job.dataConsegnaFinale)}</div>
                </div>
            </div>
            <div className="col-span-2 border-r-2 border-black flex flex-col items-center justify-center p-2 bg-white relative">
                <span className="absolute top-1 text-[6px] text-blue-600 font-bold uppercase">CODICE COMMESSA</span>
                <QRCode value={`${job.ordinePF}@${job.details}@${job.qta}`} size={85} />
            </div>
            <div className="col-span-6 p-2 text-center flex items-center justify-center italic bg-gray-50/20">
                <p className="text-gray-300 text-[10px] font-bold tracking-widest uppercase opacity-30">
                    DISEGNO TECNICO / NOTE AGGIUNTIVE
                </p>
            </div>
          </div>

          {/* TABELLE MATERIALI */}
          <div className="flex-1">
            <div className="bg-[#1f2937] text-white p-1 text-center font-bold uppercase tracking-[0.2em] mb-1 text-[8px]">
                PREPARAZIONE COMPONENTI (REPARTO MAGAZZINO)
            </div>

            <table className="w-full border-collapse border border-black text-center text-[9px] mb-2">
                <thead>
                    <tr className="bg-gray-100 font-bold border-b border-black h-6">
                        <th className="border-r border-black w-[25%] px-1">COMPONENTE</th>
                        <th className="border-r border-black w-[15%]">L. TAGLIO (MM)</th>
                        <th className="border-r border-black w-[10%]">QT</th>
                        <th className="border-r border-black w-[15%]">RILEVATO</th>
                        <th className="border-r border-black w-[10%]">ESITO</th>
                        <th className="border-r border-black w-[15%]">STIMA TEMPO</th>
                        <th className="w-[10%]">NOTE</th>
                    </tr>
                </thead>
                <tbody>
                    {pageItems.map((item, i) => {
                        const totalQty = (item.quantity * job.qta);
                        const isGuaina = item.category === 'guaina';
                        const isTubi = item.category === 'tubi';
                        const mat = item.mat;
                        
                        let displayValue = totalQty.toFixed(0);
                        if (isGuaina && item.lunghezzaTaglioMm) {
                            displayValue = `${(totalQty * item.lunghezzaTaglioMm / 1000).toFixed(2)} m`;
                        } else if (isTubi && mat?.conversionFactor) {
                            displayValue = `${(totalQty * mat.conversionFactor).toFixed(2)} kg`;
                        }

                        return (
                            <tr key={i} className={cn("border-b border-black h-7", i % 2 === 0 ? "bg-white" : "bg-gray-50/50")}>
                                <td className="border-r border-black px-1 font-bold text-left">{item.component}</td>
                                <td className="border-r border-black font-mono">{item.lunghezzaTaglioMm || '---'}</td>
                                <td className="border-r border-black font-black text-sm">{totalQty.toFixed(0)}</td>
                                <td className="border-r border-black text-gray-300 text-sm">| &nbsp;&nbsp;&nbsp; |</td>
                                <td className="border-r border-black">□</td>
                                <td className="border-r border-black font-medium">{displayValue}</td>
                                <td className="px-1 text-[7px] text-left leading-none italic">{item.note || ''}</td>
                            </tr>
                        );
                    })}
                    {pageItems.length === 0 && (
                        <tr className="h-10"><td colSpan={7} className="italic text-gray-400">Nessun componente in questa pagina</td></tr>
                    )}
                </tbody>
            </table>
          </div>

          {/* FOOTER - Solo sull'ultima pagina */}
          {pageIdx === pages.length - 1 && (
            <div className="grid grid-cols-2 border border-black min-h-[60px] mt-auto">
                <div className="border-r border-black p-1 flex flex-col bg-white">
                    <span className="font-bold text-[8px] bg-orange-50 px-1 border border-orange-200 w-fit">NOTE / SEGNALAZIONI NC</span>
                    <div className="flex-1 text-[8px] text-gray-300 italic p-1">Annotazioni libere...</div>
                </div>
                <div className="p-1 flex flex-col bg-white">
                    <span className="font-bold text-[8px] bg-gray-50 px-1 border border-gray-200 w-fit">DATA E FIRMA OPERATORE</span>
                    <div className="flex-1 flex items-end justify-between px-2 pb-1 text-[8px]">
                        <span className="text-gray-400">DATA: ___/___/______</span>
                        <span className="text-gray-400">FIRMA: _____________________________</span>
                    </div>
                </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
