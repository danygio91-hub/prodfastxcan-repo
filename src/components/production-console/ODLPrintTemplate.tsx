
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

/**
 * TEMPLATE ODL STILE EXCEL
 * Questo template usa tabelle a larghezza fissa e font compatti (7pt/8pt)
 * per emulare esattamente il comportamento di un foglio di calcolo.
 */
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

  // Logica di paginazione dinamica
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
            fontFamily: "'Segoe UI', 'Calibri', sans-serif" 
          }}
        >
          {/* HEADER EXCEL-STYLE (RIGA 1-2) */}
          <table className="w-full border-collapse border border-black mb-1" style={{ tableLayout: 'fixed' }}>
            <tbody>
              <tr>
                <td className="border border-black p-1 text-left" style={{ width: '15%' }}>
                  <img src="/logo.png" alt="Logo" className="h-6 w-auto grayscale" />
                </td>
                <td className="border border-black p-1 text-center font-black underline" style={{ width: '70%', fontSize: '14pt' }}>
                  SCHEDA DI LAVORAZIONE
                </td>
                <td className="border border-black p-1 text-right italic" style={{ width: '15%', fontSize: '6pt' }}>
                  MOD. 800_5_02 REV.0<br/>Pag. {pageIdx + 1}/{pages.length}
                </td>
              </tr>
            </tbody>
          </table>

          {/* GRID INFO (RIGA 3-4) */}
          <table className="w-full border-collapse border border-black mb-1 text-[8pt]" style={{ tableLayout: 'fixed' }}>
            <tbody>
              <tr className="h-8">
                <td className="border border-black p-1 text-center bg-gray-50">
                  <span className="block text-[6pt] text-gray-500 uppercase font-bold">Reparto</span>
                  <span className="font-bold">{job.department || 'N/D'}</span>
                </td>
                <td className="border border-black p-1 text-center">
                  <span className="block text-[6pt] text-gray-500 uppercase font-bold">Data ODL</span>
                  <span className="font-bold">{formatDateSafe(job.odlCreationDate || new Date())}</span>
                </td>
                <td className="border border-black p-1 text-center">
                  <span className="block text-[6pt] text-gray-500 uppercase font-bold">N° Ord. Interno</span>
                  <span className="font-bold">{job.numeroODLInterno || '---'}</span>
                </td>
                <td className="border border-black p-1 text-center bg-[#dbeafe]" style={{ width: '25%' }}>
                  <span className="block text-[6pt] font-bold text-blue-800 uppercase">Ordine PF</span>
                  <span className="font-black text-[11pt]">{job.ordinePF}</span>
                </td>
                <td className="border border-black p-1 text-center bg-[#ecfdf5]" style={{ width: '20%' }}>
                  <span className="block text-[6pt] font-bold text-emerald-800 uppercase">N° ODL</span>
                  <span className="font-black text-[11pt] text-emerald-700">{job.numeroODL || '---'}</span>
                </td>
              </tr>
            </tbody>
          </table>

          {/* DATI CENTRALI (RIGA 5-10) */}
          <table className="w-full border-collapse border border-black mb-1" style={{ tableLayout: 'fixed' }}>
            <tbody>
              <tr>
                <td className="border border-black" style={{ width: '35%' }}>
                  <table className="w-full border-collapse text-[8pt]">
                    <tbody>
                      <tr className="border-b border-black">
                        <td className="bg-gray-50 font-bold p-1 border-r border-black w-1/3">Cliente</td>
                        <td className="p-1 font-bold truncate">{job.cliente}</td>
                      </tr>
                      <tr className="border-b border-black">
                        <td className="bg-gray-50 font-bold p-1 border-r border-black w-1/3">Cod. Articolo</td>
                        <td className="p-1 font-black text-[10pt]">{job.details}</td>
                      </tr>
                      <tr className="border-b border-black">
                        <td className="bg-gray-50 font-bold p-1 border-r border-black w-1/3">Quantità</td>
                        <td className="p-1 font-black text-[14pt] leading-none">{job.qta}</td>
                      </tr>
                      <tr>
                        <td className="bg-gray-50 font-bold p-1 border-r border-black w-1/3 leading-tight">Data Fine Prep.</td>
                        <td className="p-1 font-black text-red-600">{formatDateSafe(job.dataConsegnaFinale)}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td className="border border-black p-2 text-center bg-white" style={{ width: '15%' }}>
                  <div className="flex flex-col items-center justify-center gap-1">
                    <span className="text-[5pt] text-blue-600 font-bold uppercase">CODICE COMMESSA</span>
                    <QRCode value={`${job.ordinePF}@${job.details}@${job.qta}`} size={55} />
                  </div>
                </td>
                <td className="border border-black p-2 text-center italic bg-gray-50/20" style={{ width: '50%' }}>
                  <p className="text-gray-300 text-[8pt] font-bold tracking-widest uppercase opacity-40">
                    DISEGNO TECNICO / NOTE AGGIUNTIVE
                  </p>
                </td>
              </tr>
            </tbody>
          </table>

          {/* LABEL SEZIONE */}
          <div className="bg-[#1f2937] text-white border border-black p-1 text-center font-black uppercase tracking-[0.3em] mb-1 text-[7pt]">
            PREPARAZIONE COMPONENTI COMMESSE (MAGAZZINO)
          </div>

          {/* TABELLA MATERIALI (CORPO CENTRALE) */}
          <div className="flex-1 overflow-hidden">
            <table className="w-full border-collapse border border-black text-center text-[7.5pt]" style={{ tableLayout: 'fixed' }}>
                <thead className="bg-gray-100 font-bold">
                    <tr className="border-b border-black h-6">
                        <th className="border-r border-black px-1 text-left" style={{ width: '25%' }}>COMPONENTE</th>
                        <th className="border-r border-black" style={{ width: '15%' }}>L. TAGLIO (MM)</th>
                        <th className="border-r border-black" style={{ width: '10%' }}>QT</th>
                        <th className="border-r border-black" style={{ width: '15%' }}>VERIFICA</th>
                        <th className="border-r border-black" style={{ width: '10%' }}>OK</th>
                        <th className="border-r border-black" style={{ width: '15%' }}>STIMA</th>
                        <th className="px-1 text-left" style={{ width: '10%' }}>ALERT</th>
                    </tr>
                </thead>
                <tbody>
                    {pageItems.map((item, i) => {
                        const totalQty = (item.quantity * job.qta);
                        const isGuaina = item.category === 'guaina';
                        const mat = item.mat;
                        
                        let displayValue = totalQty.toFixed(0);
                        if (isGuaina && item.lunghezzaTaglioMm) {
                            displayValue = `${(totalQty * item.lunghezzaTaglioMm / 1000).toFixed(2)} m`;
                        } else if (item.category === 'tubi' && mat?.conversionFactor) {
                            displayValue = `${(totalQty * mat.conversionFactor).toFixed(2)} kg`;
                        }

                        return (
                            <tr key={i} className={cn("border-b border-black h-6", i % 2 === 0 ? "bg-white" : "bg-gray-50/50")}>
                                <td className="border-r border-black px-1 font-bold text-left truncate">{item.component}</td>
                                <td className="border-r border-black font-mono">{item.lunghezzaTaglioMm || '---'}</td>
                                <td className="border-r border-black font-black">{totalQty.toFixed(0)}</td>
                                <td className="border-r border-black text-gray-300">| &nbsp;&nbsp;&nbsp; |</td>
                                <td className="border-r border-black">□</td>
                                <td className="border-r border-black font-medium">{displayValue}</td>
                                <td className="px-1 text-[6pt] text-left leading-none italic truncate">{item.note || ''}</td>
                            </tr>
                        );
                    })}
                    {/* Riempimento righe vuote per mantenere il layout se necessario */}
                    {pageItems.length < ITEMS_PER_PAGE && Array.from({ length: ITEMS_PER_PAGE - pageItems.length }).map((_, idx) => (
                        <tr key={`empty-${idx}`} className="border-b border-black h-6 opacity-0">
                            <td colSpan={7}>&nbsp;</td>
                        </tr>
                    ))}
                </tbody>
            </table>
          </div>

          {/* FOOTER (RIGA FINALE) */}
          {pageIdx === pages.length - 1 && (
            <div className="grid grid-cols-2 border border-black h-[45px] mt-1">
                <div className="border-r border-black p-1 flex flex-col bg-white">
                    <span className="font-bold text-[6pt] bg-orange-50 px-1 border border-orange-200 w-fit leading-none mb-1">SEGNALAZIONE OPERATORE (NOTE / NC)</span>
                    <div className="flex-1 text-[7pt] text-gray-200 italic p-1 border border-dashed border-gray-100">...</div>
                </div>
                <div className="p-1 flex flex-col bg-white">
                    <div className="flex-1 flex items-end justify-between px-4 pb-1 text-[7pt] font-bold">
                        <span className="text-gray-400">DATA: ___/___/______</span>
                        <span className="text-gray-400">FIRMA OPERATORE: ____________________________</span>
                    </div>
                </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
