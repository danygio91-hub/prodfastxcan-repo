
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
 * TEMPLATE ODL GRIGLIA EXCEL (A-G / 1-37)
 * Riproduzione millimetrica basata sul modello Excel fornito.
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

  // Suddivisione per le 3 tabelle
  const trecciaItems = allItems.filter(i => i.category === 'treccia');
  const tubiItems = allItems.filter(i => i.category === 'tubi');
  const guainaItems = allItems.filter(i => i.category === 'guaina');

  // Regola del supervisore: Multi-pagina se righe > 15
  const ITEMS_PER_PAGE = 15;
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

  const getEstimatedTime = (type: string) => {
    if (!article?.phaseTimes) return 'N/D';
    let phaseId = '';
    if (type === 'treccia') phaseId = 'phase-template-1';
    else if (type === 'tubi') phaseId = 'phase-template-7';
    else if (type === 'guaina') phaseId = 'phase-template-6';
    
    const time = article.phaseTimes[phaseId]?.expectedMinutesPerPiece || 0;
    if (time <= 0) return 'N/D';
    const tot = time * job.qta;
    const h = Math.floor(tot / 60);
    const m = Math.round(tot % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div id="odl-pdf-pages" className="bg-gray-200 flex flex-col gap-8 items-center" style={{ position: 'absolute', top: '-20000px', left: '-20000px' }}>
      {pages.map((pageItems, pageIdx) => (
        <div 
          key={pageIdx} 
          className="odl-page bg-white text-black shadow-xl relative overflow-hidden flex flex-col"
          style={{ 
            width: PAGE_WIDTH, 
            height: PAGE_HEIGHT, 
            padding: '5mm',
            boxSizing: 'border-box',
            fontFamily: "var(--font-pt-sans), 'Calibri', 'Arial', sans-serif" 
          }}
        >
          {/* GRIGLIA MASTER EXCEL (A-G) */}
          <table className="w-full border-collapse border-2 border-black" style={{ tableLayout: 'fixed', fontSize: '8pt' }}>
            <colgroup>
                <col style={{ width: '15%' }} /> {/* A */}
                <col style={{ width: '15%' }} /> {/* B */}
                <col style={{ width: '15%' }} /> {/* C */}
                <col style={{ width: '15%' }} /> {/* D */}
                <col style={{ width: '15%' }} /> {/* E */}
                <col style={{ width: '12.5%' }} /> {/* F */}
                <col style={{ width: '12.5%' }} /> {/* G */}
            </colgroup>
            <tbody>
              {/* RIGA 1: LOGO E TITOLO */}
              <tr style={{ height: '10mm' }}>
                <td className="border border-black p-1 text-center" rowSpan={4}>
                    <img src="/logo.png" alt="Logo" className="h-8 w-auto grayscale mx-auto" />
                </td>
                <td className="border border-black p-1 text-center font-black bg-[#dbeafe]" colSpan={4} style={{ fontSize: '14pt', letterSpacing: '2px' }}>
                    SCHEDA DI LAVORAZIONE
                </td>
                <td className="border border-black p-1 text-right italic font-bold" colSpan={2} style={{ fontSize: '6pt' }}>
                    MOD. 800_5_02 REV.0 del 08/05/2024<br/>Pag. {pageIdx + 1}/{pages.length}
                </td>
              </tr>

              {/* RIGA 2-4: INFO HEADER (REPARTO, DATA, ODL) */}
              <tr style={{ height: '6mm' }}>
                <td className="border border-black p-0 text-center font-bold bg-gray-50 italic" style={{ fontSize: '7pt' }}>REPARTO</td>
                <td className="border border-black p-0 text-center font-bold bg-gray-50 italic" style={{ fontSize: '7pt' }}>DATA ODL</td>
                <td className="border border-black p-0 text-center font-bold bg-gray-50 italic" style={{ fontSize: '7pt' }}>N° ORD. INTERNO</td>
                <td className="border border-black p-0 text-center font-bold bg-[#ffedd5] italic" style={{ fontSize: '7pt' }}>NUMERO ORDINE PF</td>
                <td className="border border-black p-0 text-center font-bold bg-[#ecfdf5] italic" colSpan={2} style={{ fontSize: '7pt' }}>N° ODL</td>
              </tr>
              <tr style={{ height: '8mm' }}>
                <td className="border border-black p-1 text-center font-black">{job.department || 'N/D'}</td>
                <td className="border border-black p-1 text-center font-bold">{formatDateSafe(job.odlCreationDate || new Date())}</td>
                <td className="border border-black p-1 text-center font-bold">{job.numeroODLInterno || '---'}</td>
                <td className="border border-black p-1 text-center font-black text-blue-800" style={{ fontSize: '11pt' }}>{job.ordinePF}</td>
                <td className="border border-black p-1 text-center font-black text-emerald-700" colSpan={2} style={{ fontSize: '11pt' }}>{job.numeroODL || '---'}</td>
              </tr>

              {/* RIGA 5-14: DATI COMMESSA, QR E DISEGNO */}
              <tr>
                <td className="border border-black p-1 font-bold italic bg-gray-50" style={{ height: '10mm' }}>CLIENTE</td>
                <td className="border border-black p-1 font-black" style={{ fontSize: '9pt' }}>{job.cliente}</td>
                <td className="border border-black p-2 text-center" rowSpan={10} colSpan={1}>
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-blue-600 font-black" style={{ fontSize: '5pt' }}>CODICE COMMESSA</span>
                        <QRCode value={`${job.ordinePF}@${job.details}@${job.qta}`} size={60} />
                    </div>
                </td>
                <td className="border border-black p-4 text-center italic text-gray-300" rowSpan={10} colSpan={4}>
                    <p className="tracking-[0.2em] font-black uppercase opacity-30" style={{ fontSize: '10pt' }}>
                        DISEGNO ALLEGATO AL CODICE ARTICOLO<br/>IN ANAGRAFICA
                    </p>
                </td>
              </tr>
              <tr>
                <td className="border border-black p-1 font-bold italic bg-gray-50" style={{ height: '10mm' }}>CODICE ARTICOLO</td>
                <td className="border border-black p-1 font-black" style={{ fontSize: '12pt' }}>{job.details}</td>
              </tr>
              <tr>
                <td className="border border-black p-1 font-bold italic bg-gray-50" style={{ height: '10mm' }}>DISEGNO</td>
                <td className="border border-black p-1 italic text-gray-400">---</td>
              </tr>
              <tr>
                <td className="border border-black p-1 font-bold italic bg-gray-50" style={{ height: '10mm' }}>QT</td>
                <td className="border border-black p-1 font-black" style={{ fontSize: '16pt' }}>{job.qta}</td>
              </tr>
              <tr>
                <td className="border border-black p-1 font-bold italic bg-gray-50 leading-tight" style={{ fontSize: '7pt' }}>DATA FINE PREPARAZIONE MATERIALE</td>
                <td className="border border-black p-1 font-black text-red-600" style={{ fontSize: '11pt' }}>{formatDateSafe(job.dataConsegnaFinale)}</td>
              </tr>

              {/* RIGA 15: DIVISORE MAGAZZINO */}
              <tr style={{ height: '6mm' }}>
                <td className="border-2 border-black p-1 text-center font-black bg-[#1f2937] text-white uppercase tracking-[0.4em]" colSpan={7} style={{ fontSize: '7.5pt' }}>
                    PREPARAZIONE COMPONENTI COMMESSE (REPARTO MAGAZZINO)
                </td>
              </tr>

              {/* TABELLE MATERIALI (SOLO RIGHE PAGINATE) */}
              <tr style={{ height: '6mm' }} className="bg-gray-100 font-black">
                <td className="border border-black px-1">COMPONENTE</td>
                <td className="border border-black text-center">SPECIALE</td>
                <td className="border border-black text-center">QT</td>
                <td className="border border-black text-center">Verifica misura</td>
                <td className="border border-black text-center">Fatto</td>
                <td className="border border-black text-center" colSpan={2}>Note / Alert</td>
              </tr>
              {pageItems.map((item, i) => (
                <tr key={`item-${i}`} style={{ height: '8mm' }}>
                    <td className="border border-black px-1 font-bold truncate">{item.component}</td>
                    <td className="border border-black text-center font-mono">
                        {item.category === 'treccia' || item.category === 'guaina' ? (item.lunghezzaTaglioMm ? `${item.lunghezzaTaglioMm}mm` : '---') : (item.mat?.conversionFactor ? `${item.mat.conversionFactor}kg/pz` : '---')}
                    </td>
                    <td className="border border-black text-center font-black">
                        {item.category === 'guaina' ? `${(item.quantity * job.qta * (item.lunghezzaTaglioMm || 0) / 1000).toFixed(2)}m` : (item.quantity * job.qta).toFixed(0)}
                    </td>
                    <td className="border border-black text-center text-gray-300">| &nbsp;&nbsp;&nbsp;&nbsp; |</td>
                    <td className="border border-black text-center text-lg">□</td>
                    <td className="border border-black px-1 text-[6pt] italic truncate" colSpan={2}>{item.note || ''}</td>
                </tr>
              ))}

              {/* FOOTER (NOTE E FIRME) - SOLO NELL'ULTIMA PAGINA */}
              {pageIdx === pages.length - 1 && (
                <>
                    <tr style={{ height: '6mm' }}>
                        <td className="border-2 border-black p-1 text-center font-black bg-[#ffedd5]" colSpan={4} style={{ fontSize: '7.5pt' }}>
                            Segnalazione Operatore (note - NC)
                        </td>
                        <td className="border-2 border-black p-1 text-center font-black bg-gray-100" colSpan={3} style={{ fontSize: '7.5pt' }}>
                            Data e Firma Operatore
                        </td>
                    </tr>
                    <tr style={{ height: '30mm' }}>
                        <td className="border border-black p-2 italic text-gray-300 align-top" colSpan={4} style={{ fontSize: '7pt' }}>
                            SPAZIO NOTE DA TENERE PER COMPILAZIONE MANUALE DELL'OPERATORE...
                        </td>
                        <td className="border border-black p-2 align-bottom text-right" colSpan={3}>
                            <div className="flex justify-between items-end w-full font-bold text-gray-400" style={{ fontSize: '7pt' }}>
                                <span>DATA: ___/___/______</span>
                                <span>FIRMA: ________________________________</span>
                            </div>
                        </td>
                    </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
