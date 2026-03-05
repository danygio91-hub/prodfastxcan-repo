
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

const PAGE_WIDTH = "297mm";
const PAGE_HEIGHT = "210mm";

export default function ODLPrintTemplate({ job, article, materials }: ODLPrintTemplateProps) {
  const materialsMap = new Map(materials.map(m => [m.code.toUpperCase(), m]));

  const allItems = (job.billOfMaterials || []).map(item => {
    const mat = materialsMap.get(item.component.toUpperCase());
    const type = mat?.type || 'OTHER';
    let category: 'treccia' | 'tubi' | 'guaina' = 'treccia';
    if (type === 'TUBI') category = 'tubi';
    else if (type === 'GUAINA') category = 'guaina';
    return { ...item, category, mat };
  });

  // Logica di paginazione dinamica per stile Excel compatto
  // Aumentiamo gli elementi per pagina poiché abbiamo ridotto i font
  const ITEMS_PER_PAGE = 22; 
  const pages: any[][] = [];
  for (let i = 0; i < allItems.length; i += ITEMS_PER_PAGE) {
    pages.push(allItems.slice(i, i + ITEMS_PER_PAGE));
  }

  if (pages.length === 0) pages.push([]);

  const formatDateSafe = (dateInput: any) => {
      if (!dateInput) return '---';
      try {
        const d = typeof dateInput === 'string' ? parseISO(dateInput) : (dateInput.toDate ? dateInput.toDate() : new Date(dateInput));
        return isValid(d) ? format(d, 'dd/MM/yyyy') : '---';
      } catch (e) { return '---'; }
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
            padding: '4mm',
            boxSizing: 'border-box',
            fontFamily: 'sans-serif' 
          }}
        >
          {/* HEADER COMPATTO EXCEL STYLE */}
          <div className="flex justify-between items-start mb-1 border-b border-black pb-0.5">
            <div className="flex items-center gap-2">
                <img src="/logo.png" alt="PF" className="h-5 w-auto grayscale" />
                <div className="text-[6px] font-bold uppercase leading-none opacity-60">
                    Power Flex S.r.l.
                </div>
            </div>
            <div className="text-center flex-1">
                <h1 className="text-xs font-black tracking-widest underline leading-tight">SCHEDA DI LAVORAZIONE</h1>
            </div>
            <div className="text-[5px] text-right font-bold italic">
                MOD. 800_5_02 REV.0 - Pag. {pageIdx + 1}/{pages.length}
            </div>
          </div>

          {/* INFO GRID COMPATTA */}
          <div className="grid grid-cols-5 border border-black mb-1 bg-white text-[7px]">
            <div className="border-r border-black p-0.5 text-center">
                <span className="block text-[5px] uppercase text-gray-500 font-bold">Reparto</span>
                <span className="font-bold truncate">{job.department || 'N/D'}</span>
            </div>
            <div className="border-r border-black p-0.5 text-center">
                <span className="block text-[5px] uppercase text-gray-500 font-bold">Data ODL</span>
                <span className="font-bold">{formatDateSafe(job.odlCreationDate || new Date())}</span>
            </div>
            <div className="border-r border-black p-0.5 text-center">
                <span className="block text-[5px] uppercase text-gray-500 font-bold">N° Ord. Interno</span>
                <span className="font-bold">{job.numeroODLInterno || '---'}</span>
            </div>
            <div className="border-r border-black p-0.5 text-center bg-[#dbeafe]">
                <span className="block text-[5px] font-bold text-blue-800">Ordine PF</span>
                <span className="font-black text-[9px]">{job.ordinePF}</span>
            </div>
            <div className="p-0.5 text-center bg-[#ecfdf5]">
                <span className="block text-[5px] font-bold text-emerald-800">N° ODL</span>
                <span className="font-black text-[9px] text-emerald-700">{job.numeroODL || '---'}</span>
            </div>
          </div>

          {/* DATI CENTRALI COMPRESSI */}
          <div className="grid grid-cols-12 border border-black mb-1 h-[65px]">
            <div className="col-span-4 border-r border-black flex flex-col text-[8px]">
                <div className="grid grid-cols-3 flex-1">
                    <div className="col-span-1 p-0.5 font-bold uppercase bg-gray-50 border-r border-b flex items-center">Cliente</div>
                    <div className="col-span-2 p-0.5 border-b truncate flex items-center">{job.cliente}</div>
                    
                    <div className="col-span-1 p-0.5 font-bold uppercase bg-gray-50 border-r border-b flex items-center">Articolo</div>
                    <div className="col-span-2 p-0.5 border-b font-black text-[9px] tracking-tighter flex items-center">{job.details}</div>
                    
                    <div className="col-span-1 p-0.5 font-bold uppercase bg-gray-50 border-r border-b flex items-center">Q.tà</div>
                    <div className="col-span-2 p-0.5 border-b font-black text-lg leading-none flex items-center">{job.qta}</div>
                    
                    <div className="col-span-1 p-0.5 font-bold uppercase bg-gray-50 border-r text-[6px] leading-tight flex items-center">Consegna</div>
                    <div className="col-span-2 p-0.5 font-bold text-red-600 flex items-center">{formatDateSafe(job.dataConsegnaFinale)}</div>
                </div>
            </div>
            <div className="col-span-2 border-r border-black flex flex-col items-center justify-center p-1 bg-white relative">
                <span className="absolute top-0.5 text-[4px] text-blue-600 font-bold uppercase">QR CODICE</span>
                <QRCode value={`${job.ordinePF}@${job.details}@${job.qta}`} size={45} />
            </div>
            <div className="col-span-6 p-1 text-center flex items-center justify-center italic bg-gray-50/10">
                <p className="text-gray-300 text-[7px] font-bold tracking-widest uppercase opacity-30">
                    DISEGNO TECNICO / NOTE
                </p>
            </div>
          </div>

          {/* TABELLA MATERIALI EXCEL STYLE COMPATTA */}
          <div className="flex-1 overflow-hidden">
            <table className="w-full border-collapse border border-black text-center text-[7.5px]">
                <thead>
                    <tr className="bg-gray-100 font-bold border-b border-black h-4">
                        <th className="border-r border-black w-[25%] px-1 text-left">COMPONENTE</th>
                        <th className="border-r border-black w-[15%]">L. TAGLIO (MM)</th>
                        <th className="border-r border-black w-[10%]">QT</th>
                        <th className="border-r border-black w-[15%]">RILEVATO</th>
                        <th className="border-r border-black w-[10%]">ESITO</th>
                        <th className="border-r border-black w-[15%]">STIMA UNIT.</th>
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
                            <tr key={i} className={cn("border-b border-black h-5", i % 2 === 0 ? "bg-white" : "bg-gray-50/50")}>
                                <td className="border-r border-black px-1 font-bold text-left truncate">{item.component}</td>
                                <td className="border-r border-black font-mono">{item.lunghezzaTaglioMm || '---'}</td>
                                <td className="border-r border-black font-black">{totalQty.toFixed(0)}</td>
                                <td className="border-r border-black text-gray-300">| &nbsp;&nbsp;&nbsp; |</td>
                                <td className="border-r border-black text-xs leading-none">□</td>
                                <td className="border-r border-black font-medium">{displayValue}</td>
                                <td className="px-1 text-[5px] text-left leading-none italic truncate">{item.note || ''}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
          </div>

          {/* FOOTER COMPRIMIBILE */}
          {pageIdx === pages.length - 1 && (
            <div className="grid grid-cols-2 border border-black h-[30px] mt-0.5">
                <div className="border-r border-black p-0.5 flex flex-col bg-white">
                    <span className="font-bold text-[6px] bg-orange-50 px-1 border border-orange-200 w-fit leading-none">SEGNALAZIONI NC</span>
                    <div className="flex-1 text-[6px] text-gray-200 italic p-0.5">...</div>
                </div>
                <div className="p-0.5 flex flex-col bg-white">
                    <div className="flex-1 flex items-end justify-between px-2 text-[6px] font-bold">
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
