
"use client";

import React from 'react';
import QRCode from 'react-qr-code';
import { format, isValid, parseISO } from 'date-fns';
import type { JobOrder, RawMaterial, Article } from '@/lib/mock-data';

interface ODLPrintTemplateProps {
  job: JobOrder;
  article: Article | null;
  materials: RawMaterial[];
}

export default function ODLPrintTemplate({ job, materials }: ODLPrintTemplateProps) {
  const materialsMap = new Map(materials.map(m => [m.code.toUpperCase(), m]));

  const allItems = (job.billOfMaterials || []).map(item => {
    const mat = materialsMap.get(item.component.toUpperCase());
    const type = mat?.type?.toUpperCase() || 'TRECCIA';
    return { ...item, type, mat };
  });

  const trecciaItems = allItems.filter(i => i.type === 'TRECCIA' || i.type === 'BOB' || i.type === 'PF3V0' || i.type === 'BARRA');
  const tubiItems = allItems.filter(i => i.type === 'TUBI');
  const guainaItems = allItems.filter(i => i.type === 'GUAINA');

  const ITEMS_PER_PAGE = 12;
  const totalItems = trecciaItems.length + tubiItems.length + guainaItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));

  const formatDateSafe = (dateInput: any) => {
    if (!dateInput) return '---';
    try {
      const d = typeof dateInput === 'string' ? parseISO(dateInput) : (dateInput.toDate ? dateInput.toDate() : new Date(dateInput));
      return isValid(d) ? format(d, 'dd/MM/yyyy') : '---';
    } catch (e) { return '---'; }
  };

  const styles = {
    page: {
      width: "297mm",
      height: "210mm",
      padding: "5mm",
      backgroundColor: "white",
      color: "black",
      fontFamily: "'PT Sans', 'Calibri', sans-serif",
      boxSizing: "border-box" as const,
      display: "flex",
      flexDirection: "column" as const,
      overflow: "hidden",
    },
    masterTable: {
      width: "100%",
      borderCollapse: "collapse" as const,
      tableLayout: "fixed" as const,
      border: "1.5px solid black",
    },
    cell: {
      border: "1px solid black",
      padding: "2px 4px",
      fontSize: "8pt",
      height: "7mm",
      verticalAlign: "middle" as const,
      lineHeight: "1.1",
    },
    headerGray: "#f3f4f6",
    headerOrange: "#ffedd5",
    headerGreen: "#ecfdf5",
    title: {
      backgroundColor: "#337ab7",
      color: "white",
      fontWeight: "bold" as const,
      fontSize: "12pt",
      textAlign: "center" as const,
      verticalAlign: "middle" as const,
    }
  };

  const pages = [];
  for (let p = 0; p < totalPages; p++) {
    pages.push(
      <div key={p} className="odl-page" style={styles.page}>
        <table style={styles.masterTable}>
          <colgroup>
            <col width="14%" />
            <col width="14%" />
            <col width="14%" />
            <col width="14%" />
            <col width="14%" />
            <col width="15%" />
            <col width="15%" />
          </colgroup>

          <tbody>
            {/* RIGHE 1-4: HEADER */}
            <tr>
              <td style={{ ...styles.cell, textAlign: 'center' }} rowSpan={3}>
                <img src="/logo.png" alt="Logo" style={{ height: '10mm', maxWidth: '90%', display: 'inline-block' }} />
              </td>
              <td style={styles.title} colSpan={4}>SCHEDA DI LAVORAZIONE</td>
              <td style={{ ...styles.cell, textAlign: 'right', fontSize: '6pt' }} colSpan={2}>
                MOD. 800_5_02 REV.0 del 08/05/2024<br/>Pag. {p + 1}/{totalPages}
              </td>
            </tr>
            <tr style={{ backgroundColor: styles.headerGray, fontWeight: 'bold', textAlign: 'center', fontSize: '7pt' }}>
              <td style={styles.cell}>REPARTO</td>
              <td style={styles.cell}>DATA ODL</td>
              <td style={styles.cell}>N° ORD. INTERNO</td>
              <td style={{ ...styles.cell, backgroundColor: styles.headerOrange }}>NUMERO ORDINE PF</td>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGreen }} colSpan={2}>N° ODL</td>
            </tr>
            <tr style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '9pt' }}>
              <td style={styles.cell}>{job.department || '---'}</td>
              <td style={styles.cell}>{formatDateSafe(job.odlCreationDate)}</td>
              <td style={styles.cell}>{job.numeroODLInterno || '---'}</td>
              <td style={styles.cell}>{job.ordinePF}</td>
              <td style={styles.cell} colSpan={2}>{job.numeroODL || 'MANUALE'}</td>
            </tr>

            {/* RIGHE 5-14: DATI E QR CODE CENTRATO */}
            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold' }}>CLIENTE</td>
              <td style={{ ...styles.cell, fontWeight: 'bold' }}>{job.cliente}</td>
              <td style={{ ...styles.cell, padding: '0' }} rowSpan={5}>
                <div style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    height: '100%', 
                    width: '100%' 
                }}>
                    <div style={{ fontSize: '6pt', fontWeight: 'bold', color: '#337ab7', marginBottom: '4px' }}>CODICE COMMESSA</div>
                    <QRCode value={`${job.ordinePF}@${job.details}@${job.qta}`} size={60} />
                </div>
              </td>
              <td style={{ ...styles.cell, textAlign: 'center', color: '#ccc', fontStyle: 'italic' }} rowSpan={5} colSpan={4}>
                DISEGNO ALLEGATO AL CODICE ARTICOLO IN ANAGRAFICA
              </td>
            </tr>
            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold' }}>CODICE ARTICOLO</td>
              <td style={{ ...styles.cell, fontWeight: 'bold', fontSize: '10pt' }}>{job.details}</td>
            </tr>
            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold' }}>DISEGNO</td>
              <td style={styles.cell}>---</td>
            </tr>
            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold' }}>QT</td>
              <td style={{ ...styles.cell, fontWeight: 'bold', fontSize: '14pt' }}>{job.qta}</td>
            </tr>
            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold' }}>DATA FINE PREP.</td>
              <td style={{ ...styles.cell, color: 'red', fontWeight: 'bold' }}>{formatDateSafe(job.dataConsegnaFinale)}</td>
            </tr>

            {/* RIGA 15: SEPARATORE NERO */}
            <tr style={{ backgroundColor: 'black', color: 'white', fontWeight: 'bold', textAlign: 'center', fontSize: '7pt' }}>
              <td colSpan={7} style={{ height: '5mm' }}>PREPARAZIONE COMPONENTI COMMESSE (REPARTO MAGAZZINO)</td>
            </tr>

            {/* TABELLE MATERIALI */}
            <tr style={{ backgroundColor: styles.headerGray, fontWeight: 'bold', fontSize: '7pt', textAlign: 'center' }}>
              <td style={styles.cell} colSpan={2}>TRECCIA/CORDA</td>
              <td style={styles.cell}>L TAGLIO mm</td>
              <td style={styles.cell}>QT</td>
              <td style={styles.cell}>Verifica</td>
              <td style={styles.cell}>OK</td>
              <td style={styles.cell}>ALERT</td>
            </tr>
            {trecciaItems.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE).map((item, i) => (
              <tr key={`t-${i}`} style={{ height: '8mm' }}>
                <td style={styles.cell} colSpan={2}>{item.component}</td>
                <td style={{ ...styles.cell, textAlign: 'center' }}>{item.lunghezzaTaglioMm || '---'}</td>
                <td style={{ ...styles.cell, textAlign: 'center', fontWeight: 'bold' }}>{(item.quantity * job.qta).toFixed(0)}</td>
                <td style={{ ...styles.cell, textAlign: 'center', color: '#ccc' }}>| &nbsp;&nbsp; |</td>
                <td style={{ ...styles.cell, textAlign: 'center' }}>□</td>
                <td style={{ ...styles.cell, fontSize: '6pt', color: 'red' }}>{item.note || ''}</td>
              </tr>
            ))}

            <tr style={{ backgroundColor: styles.headerGray, fontWeight: 'bold', fontSize: '7pt', textAlign: 'center' }}>
              <td style={styles.cell} colSpan={2}>CODICE TUBI</td>
              <td style={styles.cell}>QT (n°)</td>
              <td style={styles.cell}>QT (kg)</td>
              <td style={styles.cell}>Verifica</td>
              <td style={styles.cell}>OK</td>
              <td style={styles.cell}>STIMA</td>
            </tr>
            {tubiItems.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE).map((item, i) => (
              <tr key={`tu-${i}`} style={{ height: '8mm' }}>
                <td style={styles.cell} colSpan={2}>{item.component}</td>
                <td style={{ ...styles.cell, textAlign: 'center', fontWeight: 'bold' }}>{(item.quantity * job.qta).toFixed(0)}</td>
                <td style={{ ...styles.cell, textAlign: 'center' }}>{item.mat?.conversionFactor ? (item.quantity * job.qta * item.mat.conversionFactor).toFixed(3) : '---'}</td>
                <td style={{ ...styles.cell, textAlign: 'center', color: '#ccc' }}>| &nbsp;&nbsp; |</td>
                <td style={{ ...styles.cell, textAlign: 'center' }}>□</td>
                <td style={styles.cell}></td>
              </tr>
            ))}

            <tr style={{ backgroundColor: styles.headerGray, fontWeight: 'bold', fontSize: '7pt', textAlign: 'center' }}>
              <td style={styles.cell} colSpan={2}>GUAINA</td>
              <td style={styles.cell}>L TAGLIO mm</td>
              <td style={styles.cell}>QT (pz)</td>
              <td style={styles.cell}>Mt. Totali</td>
              <td style={styles.cell}>OK</td>
              <td style={styles.cell}>STIMA</td>
            </tr>
            {guainaItems.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE).map((item, i) => (
              <tr key={`g-${i}`} style={{ height: '8mm' }}>
                <td style={styles.cell} colSpan={2}>{item.component}</td>
                <td style={{ ...styles.cell, textAlign: 'center' }}>{item.lunghezzaTaglioMm || '---'}</td>
                <td style={{ ...styles.cell, textAlign: 'center' }}>{(item.quantity * job.qta).toFixed(0)}</td>
                <td style={{ ...styles.cell, textAlign: 'center', fontWeight: 'bold' }}>{((item.lunghezzaTaglioMm || 0) * item.quantity * job.qta / 1000).toFixed(2)}m</td>
                <td style={{ ...styles.cell, textAlign: 'center' }}>□</td>
                <td style={styles.cell}></td>
              </tr>
            ))}

            {/* RIGHE FINALI: NOTE E FIRMA */}
            <tr style={{ height: '15mm' }}>
              <td style={{ ...styles.cell, backgroundColor: styles.headerOrange, fontWeight: 'bold' }} colSpan={4}>Segnalazione Operatore (note - NC)</td>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold' }} colSpan={3}>Data e Firma Operatore</td>
            </tr>
            <tr style={{ height: '15mm' }}>
              <td style={styles.cell} colSpan={4}></td>
              <td style={{ ...styles.cell, verticalAlign: 'bottom', fontSize: '7pt' }} colSpan={3}>
                DATA: ___/___/______ &nbsp;&nbsp; FIRMA: _________________________
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div id="odl-pdf-pages" style={{ width: '297mm' }}>
      {pages}
    </div>
  );
}
