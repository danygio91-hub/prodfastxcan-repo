
"use client";

import React from 'react';
import QRCode from 'react-qr-code';
import { format, isValid, parseISO } from 'date-fns';
import type { JobOrder, RawMaterial, Article } from '@/lib/mock-data';

interface ODLPrintTemplateProps {
  job: JobOrder;
  article: Article | null;
  materials: RawMaterial[];
  printDate?: Date;
}

export default function ODLPrintTemplate({ job, article, materials, printDate }: ODLPrintTemplateProps) {
  const materialsMap = new Map(materials.map(m => [m.code.toUpperCase(), m]));

  const allItems = (job.billOfMaterials || []).map(item => {
    const mat = materialsMap.get(item.component.toUpperCase());
    const type = mat?.type?.toUpperCase() || 'TRECCIA';
    return { ...item, type, mat };
  });

  const trecciaItems = allItems.filter(i => ['BOB', 'PF3V0', 'BARRA', 'TRECCIA'].includes(i.type));
  const tubiItems = allItems.filter(i => i.type === 'TUBI');
  const guainaItems = allItems.filter(i => i.type === 'GUAINA');

  const ITEMS_PER_PAGE = 12;
  const totalItemsCount = trecciaItems.length + tubiItems.length + guainaItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItemsCount / ITEMS_PER_PAGE));

  const getDeptSigla = (name: string) => {
    const n = (name || '').toUpperCase();
    if (n.includes('ASSEMBLAGGIO') || n.includes('CP')) return 'CP';
    if (n.includes('QUALITÀ') || n.includes('CG')) return 'CG';
    if (n.includes('BURATTATURA') || n.includes('FINITURA') || n.includes('BF')) return 'BF';
    if (n.includes('MAGAZZINO') || n.includes('MAG')) return 'MAG';
    if (n.includes('COLLAUDO') || n.includes('TEST') || n.includes('QLTY')) return 'QLTY';
    return n.length > 4 ? n.substring(0, 3) : n;
  };

  const formatDateSafe = (dateInput: any) => {
    if (!dateInput) return '---';
    try {
      const d = typeof dateInput === 'string' ? parseISO(dateInput) : (dateInput.toDate ? dateInput.toDate() : new Date(dateInput));
      return isValid(d) ? format(d, 'dd/MM/yyyy') : '---';
    } catch (e) { return '---'; }
  };

  const getEstimatedTimeForSection = (phaseId: string) => {
    const timeData = article?.phaseTimes?.[phaseId];
    if (!timeData || !timeData.expectedMinutesPerPiece) return 'N/D';
    const totalMins = timeData.expectedMinutesPerPiece * job.qta;
    const h = Math.floor(totalMins / 60);
    const m = Math.round(totalMins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
      padding: "0",
      fontSize: "8pt",
      height: "8.5mm",
      verticalAlign: "middle" as const,
      textAlign: "center" as const,
      lineHeight: "1",
      position: "relative" as const,
    },
    flexCell: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      width: "100%",
    },
    label: {
        fontSize: "7pt",
        fontWeight: "bold" as const,
        color: "#555",
        textAlign: "center" as const,
        marginBottom: "1px",
    },
    headerGray: "#f3f4f6",
    headerOrange: "#ffedd5",
    headerGreen: "#ecfdf5",
    headerYellow: "#fff176",
    headerBlue: "#337ab7",
    bgTreccia: "#e8f5e9",
    bgTubi: "#eeeeee",
    bgGuaina: "#f3e5f5",
    
    title: {
      backgroundColor: "#337ab7",
      color: "white",
      fontWeight: "bold" as const,
      fontSize: "16pt",
      textAlign: "center" as const,
      height: "12mm",
      position: "relative" as const,
    },
    qrContainer: {
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%',
    },
    verificaGrid: {
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "stretch",
    },
    verificaSlot: {
        flex: 1,
        borderRight: "1px solid black",
    },
    valueLarge: {
        fontSize: "14pt",
        fontWeight: "bold" as const,
    },
    separatorRow: {
        backgroundColor: "#f3f4f6",
        color: "black",
        fontWeight: "bold" as const,
        fontSize: "7.5pt",
        height: "6mm",
        border: "1.5px solid black",
        position: "relative" as const,
    }
  };

  const VerificaCell = () => (
    <div style={styles.verificaGrid}>
        <div style={styles.verificaSlot}></div>
        <div style={styles.verificaSlot}></div>
        <div style={{ flex: 1 }}></div>
    </div>
  );

  const pages = [];
  for (let p = 0; p < totalPages; p++) {
    pages.push(
      <div key={p} className="odl-page" style={styles.page}>
        <table style={styles.masterTable}>
          <colgroup>
            <col width="12%" />
            <col width="22%" />
            <col width="18%" />
            <col width="12%" />
            <col width="12%" />
            <col width="12%" />
            <col width="12%" />
          </colgroup>

          <tbody>
            {/* RIGA 1-3: HEADER */}
            <tr>
              <td style={{ ...styles.cell, borderBottom: '0' }} rowSpan={3}>
                <div style={styles.qrContainer}>
                    <img src="/logo.png" alt="Logo" style={{ height: '12mm', maxWidth: '95%' }} />
                </div>
              </td>
              <td style={styles.title} colSpan={4}>
                <div style={styles.flexCell}>SCHEDA DI LAVORAZIONE</div>
              </td>
              <td style={{ ...styles.cell, textAlign: 'right', fontSize: '6.5pt', verticalAlign: 'top', padding: '2px' }} colSpan={2}>
                MOD. 800_5_02 REV.0 del 08/05/2024<br/>Pag. {p + 1}/{totalPages}
              </td>
            </tr>
            <tr style={{ backgroundColor: styles.headerGray }}>
              <td style={styles.cell}><div style={styles.label}>REPARTO</div></td>
              <td style={styles.cell}><div style={styles.label}>DATA ODL</div></td>
              <td style={{ ...styles.cell, backgroundColor: styles.headerOrange }} colSpan={2}><div style={styles.label}>NUMERO ORDINE PF</div></td>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGreen }} colSpan={2}><div style={styles.label}>N° ODL</div></td>
            </tr>
            <tr style={{ fontWeight: 'bold', fontSize: '11pt' }}>
              <td style={styles.cell}><div style={styles.flexCell}>{getDeptSigla(job.department)}</div></td>
              <td style={styles.cell}><div style={styles.flexCell}>{format(printDate || new Date(), 'dd/MM/yyyy')}</div></td>
              <td style={styles.cell} colSpan={2}><div style={styles.flexCell}>{job.ordinePF}</div></td>
              <td style={styles.cell} colSpan={2}><div style={styles.flexCell}>{job.numeroODLInterno || '---'}</div></td>
            </tr>

            {/* DATI CENTRALI */}
            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold' }}><div style={styles.flexCell}>CLIENTE</div></td>
              <td style={{ ...styles.cell, ...styles.valueLarge }}>
                <div style={styles.flexCell}>{job.cliente}</div>
              </td>
              <td style={{ ...styles.cell, fontWeight: 'bold', backgroundColor: styles.headerBlue, color: 'white' }}>
                <div style={styles.flexCell}>CODICE COMMESSA</div>
              </td>
              <td style={{ ...styles.cell, color: '#ccc', fontWeight: 'bold', fontSize: '18pt' }} rowSpan={5} colSpan={4}>
                <div style={styles.flexCell}>AREA DISEGNO</div>
              </td>
            </tr>
            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold' }}><div style={styles.flexCell}>CODICE ARTICOLO</div></td>
              <td style={{ ...styles.cell, ...styles.valueLarge }}>
                <div style={styles.flexCell}>{job.details}</div>
              </td>
              <td style={{ ...styles.cell }} rowSpan={4}>
                <div style={styles.qrContainer}>
                    <QRCode value={`${job.ordinePF}@${job.details}@${job.qta}`} size={145} />
                </div>
              </td>
            </tr>
            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold' }}><div style={styles.flexCell}>DISEGNO</div></td>
              <td style={styles.cell}><div style={styles.flexCell}>---</div></td>
            </tr>
            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold' }}><div style={styles.flexCell}>QT</div></td>
              <td style={{ ...styles.cell, ...styles.valueLarge }}><div style={styles.flexCell}>{job.qta}</div></td>
            </tr>
            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold', fontSize: '7pt' }}>
                <div style={{ ...styles.flexCell, lineHeight: '1.1' }}>DATA FINE PREPARAZIONE MATERIALE</div>
              </td>
              <td style={{ ...styles.cell, ...styles.valueLarge, backgroundColor: styles.headerYellow }}>
                <div style={styles.flexCell}>{formatDateSafe(job.dataConsegnaFinale)}</div>
              </td>
            </tr>

            {/* STRISCIA GRIGIA SOTTILE */}
            <tr>
              <td colSpan={7} style={{ ...styles.cell, backgroundColor: styles.headerGray, height: "6mm", border: "1.5px solid black" }}>
                <div style={styles.flexCell}>PREPARAZIONE COMPONENTI COMMESSE (REPARTO MAGAZZINO)</div>
              </td>
            </tr>

            {/* TRECCIA / CORDA (VERDE) */}
            {trecciaItems.length > 0 && (
                <>
                    <tr style={{ backgroundColor: styles.headerGray, fontWeight: 'bold', fontSize: '7pt' }}>
                        <td style={styles.cell} colSpan={2}>TRECCIA/CORDA</td>
                        <td style={styles.cell}>L TAGLIO mm</td>
                        <td style={styles.cell}>QT</td>
                        <td style={styles.cell}>Verifica</td>
                        <td style={styles.cell}>OK</td>
                        <td style={styles.cell}>Tempo Previsto</td>
                    </tr>
                    {trecciaItems.map((item, i) => (
                        <tr key={`t-${i}`} style={{ height: '9mm', backgroundColor: styles.bgTreccia }}>
                            <td style={{ ...styles.cell, textAlign: 'left' }} colSpan={2}><div style={{...styles.flexCell, justifyContent: 'flex-start', paddingLeft: '4px'}}>{item.component}</div></td>
                            <td style={{ ...styles.cell, fontWeight: 'bold' }}><div style={styles.flexCell}>{item.lunghezzaTaglioMm || '---'}</div></td>
                            <td style={{ ...styles.cell, fontWeight: 'bold' }}><div style={styles.flexCell}>{(item.quantity * job.qta).toFixed(0)}</div></td>
                            <td style={{ ...styles.cell, padding: '0' }}><VerificaCell /></td>
                            <td style={styles.cell}>□</td>
                            {i === 0 && (
                                <td rowSpan={trecciaItems.length} style={{ ...styles.cell, fontWeight: 'bold', fontSize: '11pt', backgroundColor: 'white' }}>
                                    <div style={styles.flexCell}>{getEstimatedTimeForSection('phase-template-1')}</div>
                                </td>
                            )}
                        </tr>
                    ))}
                </>
            )}

            {/* TUBI (GRIGIO) */}
            {tubiItems.length > 0 && (
                <>
                    <tr style={{ backgroundColor: styles.headerGray, fontWeight: 'bold', fontSize: '7pt' }}>
                        <td style={styles.cell} colSpan={2}>CODICE TUBI</td>
                        <td style={styles.cell}>QT (n°)</td>
                        <td style={styles.cell}>QT (kg)</td>
                        <td style={styles.cell}>Verifica</td>
                        <td style={styles.cell}>OK</td>
                        <td style={styles.cell}>Tempo Previsto</td>
                    </tr>
                    {tubiItems.map((item, i) => (
                        <tr key={`tu-${i}`} style={{ height: '9mm', backgroundColor: styles.bgTubi }}>
                            <td style={{ ...styles.cell, textAlign: 'left' }} colSpan={2}><div style={{...styles.flexCell, justifyContent: 'flex-start', paddingLeft: '4px'}}>{item.component}</div></td>
                            <td style={{ ...styles.cell, fontWeight: 'bold' }}><div style={styles.flexCell}>{(item.quantity * job.qta).toFixed(0)}</div></td>
                            <td style={styles.cell}><div style={styles.flexCell}>{item.mat?.conversionFactor ? (item.quantity * job.qta * item.mat.conversionFactor).toFixed(3) : '---'}</div></td>
                            <td style={{ ...styles.cell, padding: '0' }}><VerificaCell /></td>
                            <td style={styles.cell}>□</td>
                            {i === 0 && (
                                <td rowSpan={tubiItems.length} style={{ ...styles.cell, fontWeight: 'bold', fontSize: '11pt', backgroundColor: 'white' }}>
                                    <div style={styles.flexCell}>{getEstimatedTimeForSection('phase-template-7')}</div>
                                </td>
                            )}
                        </tr>
                    ))}
                </>
            )}

            {/* GUAINA (VIOLA/BLU) */}
            {guainaItems.length > 0 && (
                <>
                    <tr style={{ backgroundColor: styles.headerGray, fontWeight: 'bold', fontSize: '7pt' }}>
                        <td style={styles.cell} colSpan={2}>GUAINA</td>
                        <td style={styles.cell}>L TAGLIO mm</td>
                        <td style={styles.cell}>QT (pz)</td>
                        <td style={styles.cell}>Mt. Totali</td>
                        <td style={styles.cell}>OK</td>
                        <td style={styles.cell}>Tempo Previsto</td>
                    </tr>
                    {guainaItems.map((item, i) => (
                        <tr key={`g-${i}`} style={{ height: '9mm', backgroundColor: styles.bgGuaina }}>
                            <td style={{ ...styles.cell, textAlign: 'left' }} colSpan={2}><div style={{...styles.flexCell, justifyContent: 'flex-start', paddingLeft: '4px'}}>{item.component}</div></td>
                            <td style={{ ...styles.cell, fontWeight: 'bold' }}><div style={styles.flexCell}>{item.lunghezzaTaglioMm || '---'}</div></td>
                            <td style={{ ...styles.cell, fontWeight: 'bold' }}><div style={styles.flexCell}>{(item.quantity * job.qta).toFixed(0)}</div></td>
                            <td style={{ ...styles.cell, fontWeight: 'bold', color: '#337ab7' }}><div style={styles.flexCell}>{((item.lunghezzaTaglioMm || 0) * item.quantity * job.qta / 1000).toFixed(2)}m</div></td>
                            <td style={styles.cell}>□</td>
                            {i === 0 && (
                                <td rowSpan={guainaItems.length} style={{ ...styles.cell, fontWeight: 'bold', fontSize: '11pt', backgroundColor: 'white' }}>
                                    <div style={styles.flexCell}>{getEstimatedTimeForSection('phase-template-6')}</div>
                                </td>
                            )}
                        </tr>
                    ))}
                </>
            )}

            {/* FOOTER FIRME - ALTEZZA RIDOTTA */}
            <tr style={{ height: '10mm' }}>
              <td style={{ ...styles.cell, backgroundColor: styles.headerOrange, fontWeight: 'bold', verticalAlign: 'top', textAlign: 'left', padding: '2mm' }} colSpan={4}>Segnalazione Operatore (note - NC)</td>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold', verticalAlign: 'top', textAlign: 'left', padding: '2mm' }} colSpan={3}>Data e Firma Operatore</td>
            </tr>
            <tr style={{ height: '10mm' }}>
              <td style={styles.cell} colSpan={4}></td>
              <td style={{ ...styles.cell, verticalAlign: 'bottom', textAlign: 'left', fontSize: '7.5pt', padding: '4mm' }} colSpan={3}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'flex-end', height: '100%', paddingBottom: '1mm' }}>
                    <span style={{ fontWeight: 'bold' }}>DATA: ___/___/______</span>
                    <span style={{ fontWeight: 'bold' }}>FIRMA: ___________________________________</span>
                </div>
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
