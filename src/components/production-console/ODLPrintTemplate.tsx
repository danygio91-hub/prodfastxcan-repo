
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

/**
 * --- IL FINCATO ODL ---
 * Questo componente rappresenta il layout millimetrico dell'ODL (Scheda di Lavorazione).
 * Segue la griglia Excel A-G / 1-37.
 * 
 * PUOI MODIFICARE QUESTO FILE PER SPOSTARE LE CELLE O CAMBIARE I COLORI.
 */
export default function ODLPrintTemplate({ job, article, materials }: ODLPrintTemplateProps) {
  const materialsMap = new Map(materials.map(m => [m.code.toUpperCase(), m]));

  // Logica di categorizzazione materiali
  const allItems = (job.billOfMaterials || []).map(item => {
    const mat = materialsMap.get(item.component.toUpperCase());
    const type = mat?.type || 'OTHER';
    let category: 'treccia' | 'tubi' | 'guaina' = 'treccia';
    if (type === 'TUBI') category = 'tubi';
    else if (type === 'GUAINA') category = 'guaina';
    return { ...item, category, mat };
  });

  // REGOLE DEL SUPERVISORE: Multi-pagina se righe > 15
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

  // --- STILI DEL FINCATO ---
  const styles = {
    page: {
      width: "297mm",
      height: "210mm",
      padding: "5mm",
      backgroundColor: "white",
      color: "black",
      fontFamily: "'PT Sans', 'Calibri', 'Arial', sans-serif",
      boxSizing: "border-box" as const,
      display: "flex",
      flexDirection: "column" as const,
    },
    tableMaster: {
      width: "100%",
      borderCollapse: "collapse" as const,
      border: "2px solid black",
      tableLayout: "fixed" as const,
      fontSize: "8pt",
    },
    cell: {
      border: "1px solid black",
      padding: "2px",
    },
    headerBlue: "#dbeafe",
    headerOrange: "#ffedd5",
    headerGreen: "#ecfdf5",
    headerDark: "#1f2937",
  };

  return (
    <div id="odl-pdf-pages" style={{ position: 'absolute', top: '-20000px', left: '-20000px' }}>
      {pages.map((pageItems, pageIdx) => (
        <div key={pageIdx} className="odl-page" style={styles.page}>
          
          <table style={styles.tableMaster}>
            {/* DEFINIZIONE COLONNE A-G */}
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
              {/* RIGHE 1-4: HEADER E LOGO */}
              <tr style={{ height: '12mm' }}>
                <td style={styles.cell} rowSpan={4} align="center">
                    <img src="/logo.png" alt="Logo" style={{ height: '10mm', width: 'auto', filter: 'grayscale(1)' }} />
                </td>
                <td style={{ ...styles.cell, backgroundColor: styles.headerBlue, fontWeight: 900, fontSize: '14pt', textAlign: 'center' }} colSpan={4}>
                    SCHEDA DI LAVORAZIONE
                </td>
                <td style={{ ...styles.cell, textAlign: 'right', fontStyle: 'italic', fontWeight: 'bold', fontSize: '6pt' }} colSpan={2}>
                    MOD. 800_5_02 REV.0 del 08/05/2024<br/>Pag. {pageIdx + 1}/{pages.length}
                </td>
              </tr>

              <tr style={{ height: '6mm', backgroundColor: '#f9fafb', fontSize: '7pt', fontWeight: 'bold', fontStyle: 'italic', textAlign: 'center' }}>
                <td style={styles.cell}>REPARTO</td>
                <td style={styles.cell}>DATA ODL</td>
                <td style={styles.cell}>N° ORD. INTERNO</td>
                <td style={{ ...styles.cell, backgroundColor: styles.headerOrange }}>NUMERO ORDINE PF</td>
                <td style={{ ...styles.cell, backgroundColor: styles.headerGreen }} colSpan={2}>N° ODL</td>
              </tr>

              <tr style={{ height: '8mm', textAlign: 'center', fontWeight: 900 }}>
                <td style={styles.cell}>{job.department || 'N/D'}</td>
                <td style={styles.cell}>{formatDateSafe(job.odlCreationDate || new Date())}</td>
                <td style={styles.cell}>{job.numeroODLInterno || '---'}</td>
                <td style={{ ...styles.cell, color: '#1e40af', fontSize: '11pt' }}>{job.ordinePF}</td>
                <td style={{ ...styles.cell, color: '#065f46', fontSize: '11pt' }} colSpan={2}>{job.numeroODL || '---'}</td>
              </tr>

              {/* RIGHE 5-14: DATI COMMESSA, QR E DISEGNO */}
              <tr>
                <td style={{ ...styles.cell, fontWeight: 'bold', fontStyle: 'italic', backgroundColor: '#f9fafb', height: '10mm' }}>CLIENTE</td>
                <td style={{ ...styles.cell, fontWeight: 900, fontSize: '9pt' }}>{job.cliente}</td>
                <td style={{ ...styles.cell, textAlign: 'center' }} rowSpan={10} colSpan={1}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: '#2563eb', fontWeight: 900, fontSize: '5pt' }}>CODICE COMMESSA</span>
                        <QRCode value={`${job.ordinePF}@${job.details}@${job.qta}`} size={65} />
                    </div>
                </td>
                <td style={{ ...styles.cell, textAlign: 'center', fontStyle: 'italic', color: '#d1d5db' }} rowSpan={10} colSpan={4}>
                    <p style={{ letterSpacing: '0.2em', fontWeight: 900, textTransform: 'uppercase', opacity: 0.3, fontSize: '10pt' }}>
                        DISEGNO ALLEGATO AL CODICE ARTICOLO<br/>IN ANAGRAFICA
                    </p>
                </td>
              </tr>
              <tr>
                <td style={{ ...styles.cell, fontWeight: 'bold', fontStyle: 'italic', backgroundColor: '#f9fafb', height: '10mm' }}>CODICE ARTICOLO</td>
                <td style={{ ...styles.cell, fontWeight: 900, fontSize: '12pt' }}>{job.details}</td>
              </tr>
              <tr>
                <td style={{ ...styles.cell, fontWeight: 'bold', fontStyle: 'italic', backgroundColor: '#f9fafb', height: '10mm' }}>DISEGNO</td>
                <td style={{ ...styles.cell, fontStyle: 'italic', color: '#9ca3af' }}>---</td>
              </tr>
              <tr>
                <td style={{ ...styles.cell, fontWeight: 'bold', fontStyle: 'italic', backgroundColor: '#f9fafb', height: '10mm' }}>QT</td>
                <td style={{ ...styles.cell, fontWeight: 900, fontSize: '18pt' }}>{job.qta}</td>
              </tr>
              <tr>
                <td style={{ ...styles.cell, fontWeight: 'bold', fontStyle: 'italic', backgroundColor: '#f9fafb', lineHeight: 1.1, fontSize: '7pt' }}>DATA FINE PREPARAZIONE MATERIALE</td>
                <td style={{ ...styles.cell, fontWeight: 900, fontSize: '11pt', color: '#dc2626' }}>{formatDateSafe(job.dataConsegnaFinale)}</td>
              </tr>

              {/* RIGA 15: DIVISORE MAGAZZINO */}
              <tr style={{ height: '7mm' }}>
                <td style={{ ...styles.cell, border: '2px solid black', textAlign: 'center', fontWeight: 900, backgroundColor: styles.headerDark, color: 'white', textTransform: 'uppercase', letterSpacing: '0.4em', fontSize: '7.5pt' }} colSpan={7}>
                    PREPARAZIONE COMPONENTI COMMESSE (REPARTO MAGAZZINO)
                </td>
              </tr>

              {/* TABELLE MATERIALI (PAGINATE) */}
              <tr style={{ height: '6mm', backgroundColor: '#f3f4f6', fontWeight: 900, textAlign: 'center' }}>
                <td style={styles.cell}>COMPONENTE</td>
                <td style={styles.cell}>SPECIALE</td>
                <td style={styles.cell}>QT</td>
                <td style={styles.cell}>VERIFICA MISURA</td>
                <td style={styles.cell}>FATTO</td>
                <td style={styles.cell} colSpan={2}>NOTE / ALERT</td>
              </tr>
              {pageItems.map((item, i) => (
                <tr key={`item-${i}`} style={{ height: '9mm' }}>
                    <td style={{ ...styles.cell, fontWeight: 'bold' }}>{item.component}</td>
                    <td style={{ ...styles.cell, textAlign: 'center', fontFamily: 'monospace' }}>
                        {item.category === 'treccia' || item.category === 'guaina' ? (item.lunghezzaTaglioMm ? `${item.lunghezzaTaglioMm}mm` : '---') : (item.mat?.conversionFactor ? `${item.mat.conversionFactor}kg/pz` : '---')}
                    </td>
                    <td style={{ ...styles.cell, textAlign: 'center', fontWeight: 900, fontSize: '10pt' }}>
                        {item.category === 'guaina' ? `${(item.quantity * job.qta * (item.lunghezzaTaglioMm || 0) / 1000).toFixed(2)}m` : (item.quantity * job.qta).toFixed(0)}
                    </td>
                    <td style={{ ...styles.cell, textAlign: 'center', color: '#d1d5db' }}>| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; |</td>
                    <td style={{ ...styles.cell, textAlign: 'center', fontSize: '14pt' }}>□</td>
                    <td style={{ ...styles.cell, fontSize: '6.5pt', fontStyle: 'italic' }} colSpan={2}>{item.note || ''}</td>
                </tr>
              ))}

              {/* FOOTER: NOTE E FIRME (SOLO NELL'ULTIMA PAGINA) */}
              {pageIdx === pages.length - 1 && (
                <>
                    <tr style={{ height: '6mm' }}>
                        <td style={{ ...styles.cell, border: '2px solid black', textAlign: 'center', fontWeight: 900, backgroundColor: styles.headerOrange, fontSize: '7.5pt' }} colSpan={4}>
                            SEGNALAZIONE OPERATORE (NOTE - NC)
                        </td>
                        <td style={{ ...styles.cell, border: '2px solid black', textAlign: 'center', fontWeight: 900, backgroundColor: '#f3f4f6', fontSize: '7.5pt' }} colSpan={3}>
                            DATA E FIRMA OPERATORE
                        </td>
                    </tr>
                    <tr style={{ height: '35mm' }}>
                        <td style={{ ...styles.cell, fontStyle: 'italic', color: '#d1d5db', verticalAlign: 'top', padding: '5px' }} colSpan={4}>
                            Annotazioni manuali dell'operatore per eventuali anomalie o non conformità riscontrate durante la preparazione...
                        </td>
                        <td style={{ ...styles.cell, verticalAlign: 'bottom', padding: '5px' }} colSpan={3}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontWeight: 'bold', color: '#9ca3af', fontSize: '7pt' }}>
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
