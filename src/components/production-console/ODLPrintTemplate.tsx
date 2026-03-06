
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

  const getDeptSigla = (name: string) => {
    const n = (name || '').toUpperCase();
    if (n.includes('CONN') || n.includes('PICCOLE') || n.includes('CP')) return 'CP';
    if (n.includes('QUALITÀ') || n.includes('CG')) return 'CG';
    if (n.includes('BURATTATURA') || n.includes('FINITURA') || n.includes('BF')) return 'BF';
    if (n.includes('MAGAZZINO') || n.includes('MAG')) return 'MAG';
    if (n.includes('COLLAUDO') || n.includes('TEST') || n.includes('QLTY')) return 'QLTY';
    if (n.includes('OFFICINA') || n.includes('OFF')) return 'OFF';
    return n;
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
    if (!timeData || !timeData.expectedMinutesPerPiece) return '00:00';
    const totalMins = Math.round(timeData.expectedMinutesPerPiece * job.qta);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
      paddingBottom: "1.5mm", // Lift-up millimetrico
    },
    label: {
        fontSize: "7pt",
        fontWeight: "bold" as const,
        color: "#555",
        textAlign: "center" as const,
        marginBottom: "1px",
    },
    headerGray: "#f3f4f6",
    headerBlue: "#337ab7",
    bgValueGreen: "#c8e6c9", // Verde Pastello
    bgValueYellow: "#fff9c4", // Giallo Pastello
    bgTreccia: "#e8f5e9",
    bgTubi: "#f5f5f5",
    bgGuaina: "#e1f5fe",
    title: {
      backgroundColor: "#337ab7",
      color: "white",
      fontWeight: "bold" as const,
      fontSize: "16pt",
      textAlign: "center" as const,
      height: "12mm",
      position: "relative" as const,
    },
    qrWrapper: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%',
        padding: '3mm', // Margine quadrato richiesto
        boxSizing: 'border-box' as const,
    },
    qrInner: {
        backgroundColor: 'white',
        padding: '2mm',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
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
    spacingRow: {
        height: "3mm",
        backgroundColor: "white",
        border: "none",
    }
  };

  return (
    <div id="odl-pdf-pages" style={{ width: '297mm' }}>
      <div className="odl-page" style={styles.page}>
        <table style={styles.masterTable}>
          <colgroup>
            <col width="8%" />
            <col width="22%" />
            <col width="15%" />
            <col width="15%" />
            <col width="15%" />
            <col width="10%" />
            <col width="15%" />
          </colgroup>

          <tbody>
            <tr>
              <td style={{ ...styles.cell, borderBottom: '0', backgroundColor: 'white' }} rowSpan={3}>
                <div style={styles.qrWrapper}>
                    <img src="/logo.png" alt="Logo" style={{ height: '12mm', maxWidth: '95%' }} />
                </div>
              </td>
              <td style={styles.title} colSpan={4}>
                <div style={styles.flexCell}>SCHEDA DI LAVORAZIONE</div>
              </td>
              <td style={{ ...styles.cell, textAlign: 'right', fontSize: '6.5pt', verticalAlign: 'top', padding: '2px', backgroundColor: 'white' }} colSpan={2}>
                MOD. 800_5_02 REV.0 del 08/05/2024
              </td>
            </tr>
            <tr style={{ backgroundColor: styles.headerGray }}>
              <td style={styles.cell}><div style={styles.label}>REPARTO</div></td>
              <td style={styles.cell}><div style={styles.label}>DATA ODL</div></td>
              <td style={styles.cell} colSpan={2}><div style={styles.label}>NUMERO ORDINE PF</div></td>
              <td style={styles.cell} colSpan={2}><div style={styles.label}>N° ODL</div></td>
            </tr>
            <tr style={{ fontWeight: 'bold', fontSize: '11pt' }}>
              <td style={{ ...styles.cell, backgroundColor: styles.bgValueGreen }}><div style={styles.flexCell}>{getDeptSigla(job.department)}</div></td>
              <td style={{ ...styles.cell, backgroundColor: 'white' }}><div style={styles.flexCell}>{format(printDate || new Date(), 'dd/MM/yyyy')}</div></td>
              <td style={{ ...styles.cell, colSpan: 2, backgroundColor: styles.bgValueGreen }} colSpan={2}><div style={styles.flexCell}>{job.ordinePF}</div></td>
              <td style={{ ...styles.cell, colSpan: 2, backgroundColor: styles.bgValueGreen }} colSpan={2}><div style={styles.flexCell}>{job.numeroODLInterno || '---'}</div></td>
            </tr>

            <tr style={styles.spacingRow}><td colSpan={7}></td></tr>

            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold' }}><div style={styles.flexCell}>CLIENTE</div></td>
              <td style={{ ...styles.cell, ...styles.valueLarge, backgroundColor: 'white' }}>
                <div style={styles.flexCell}>{job.cliente}</div>
              </td>
              <td style={{ ...styles.cell, fontWeight: 'bold', backgroundColor: styles.headerBlue, color: 'white' }}>
                <div style={styles.flexCell}>CODICE COMMESSA</div>
              </td>
              <td style={{ ...styles.cell, color: '#ccc', fontWeight: 'bold', fontSize: '18pt', backgroundColor: 'white' }} rowSpan={5} colSpan={4}>
                <div style={styles.flexCell}>AREA DISEGNO</div>
              </td>
            </tr>
            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold' }}><div style={styles.flexCell}>CODICE ARTICOLO</div></td>
              <td style={{ ...styles.cell, ...styles.valueLarge, backgroundColor: styles.bgValueGreen }}>
                <div style={styles.flexCell}>{job.details}</div>
              </td>
              <td style={{ ...styles.cell, backgroundColor: 'white' }} rowSpan={4}>
                <div style={styles.qrWrapper}>
                    <div style={styles.qrInner}>
                        <QRCode value={`${job.ordinePF}@${job.details}@${job.qta}`} size={135} />
                    </div>
                </div>
              </td>
            </tr>
            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold' }}><div style={styles.flexCell}>DISEGNO</div></td>
              <td style={{ ...styles.cell, backgroundColor: 'white' }}><div style={styles.flexCell}>---</div></td>
            </tr>
            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold' }}><div style={styles.flexCell}>QT</div></td>
              <td style={{ ...styles.cell, ...styles.valueLarge, backgroundColor: styles.bgValueGreen }}><div style={styles.flexCell}>{job.qta}</div></td>
            </tr>
            <tr>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold', fontSize: '7pt' }}>
                <div style={{ ...styles.flexCell, lineHeight: '1.1' }}>DATA FINE PREPARAZIONE MATERIALE</div>
              </td>
              <td style={{ ...styles.cell, ...styles.valueLarge, backgroundColor: styles.bgValueYellow }}>
                <div style={styles.flexCell}>{formatDateSafe(job.dataConsegnaFinale)}</div>
              </td>
            </tr>

            <tr style={styles.spacingRow}><td colSpan={7}></td></tr>

            <tr>
              <td colSpan={7} style={{ ...styles.cell, backgroundColor: styles.headerGray, height: "6mm", border: "1.5px solid black" }}>
                <div style={styles.flexCell}>PREPARAZIONE COMPONENTI COMMESSE (REPARTO MAGAZZINO)</div>
              </td>
            </tr>

            {trecciaItems.length > 0 && (
                <>
                    <tr style={{ backgroundColor: 'white', fontWeight: 'bold', fontSize: '7pt' }}>
                        <td style={styles.cell}><div style={styles.flexCell}>TRECCIA/CORDA</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>L TAGLIO mm</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>QT</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>QT (kg)</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>Verifica misura mm</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>Completato</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>Tempo Previsto (hh:mm)</div></td>
                    </tr>
                    {trecciaItems.map((item, i) => {
                        const totalUnits = item.quantity * job.qta;
                        const factor = item.mat?.rapportoKgMt || item.mat?.conversionFactor || 0;
                        const weightKg = (item.lunghezzaTaglioMm ? (item.lunghezzaTaglioMm / 1000) : 1) * totalUnits * factor;
                        return (
                            <tr key={`t-${i}`} style={{ height: '9mm', backgroundColor: styles.bgTreccia }}>
                                <td style={{ ...styles.cell, textAlign: 'left' }}><div style={{...styles.flexCell, justifyContent: 'flex-start', paddingLeft: '4px'}}>{item.component}</div></td>
                                <td style={{ ...styles.cell, fontWeight: 'bold' }}><div style={styles.flexCell}>{item.lunghezzaTaglioMm || '0'}</div></td>
                                <td style={{ ...styles.cell, fontWeight: 'bold' }}><div style={styles.flexCell}>{totalUnits}</div></td>
                                <td style={{ ...styles.cell, fontWeight: 'bold' }}><div style={styles.flexCell}>{weightKg.toFixed(1)}</div></td>
                                <td style={styles.cell}><div style={styles.flexCell}><div style={styles.verificaGrid}><div style={styles.verificaSlot}></div><div style={styles.verificaSlot}></div><div style={{ flex: 1 }}></div></div></div></td>
                                <td style={styles.cell}><div style={styles.flexCell}>□</div></td>
                                {i === 0 && (
                                    <td rowSpan={trecciaItems.length} style={{ ...styles.cell, fontWeight: 'bold', fontSize: '11pt', backgroundColor: 'white' }}>
                                        <div style={styles.flexCell}>{getEstimatedTimeForSection('phase-template-1')}</div>
                                    </td>
                                )}
                            </tr>
                        )
                    })}
                    <tr style={styles.spacingRow}><td colSpan={7}></td></tr>
                </>
            )}

            {tubiItems.length > 0 && (
                <>
                    <tr style={{ backgroundColor: 'white', fontWeight: 'bold', fontSize: '7pt' }}>
                        <td style={styles.cell}><div style={styles.flexCell}>CODICE TUBI</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}></div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>QT (n°)</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>QT (kg)</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>Verifica misure</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>Prelevato da mag</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>Tempo Previsto (hh:mm)</div></td>
                    </tr>
                    {tubiItems.map((item, i) => {
                        const totalPcs = item.quantity * job.qta;
                        const totalKg = item.mat?.conversionFactor ? (totalPcs * item.mat.conversionFactor) : 0;
                        return (
                            <tr key={`tu-${i}`} style={{ height: '9mm', backgroundColor: styles.bgTubi }}>
                                <td style={{ ...styles.cell, textAlign: 'left' }}><div style={{...styles.flexCell, justifyContent: 'flex-start', paddingLeft: '4px'}}>{item.component}</div></td>
                                <td style={{ ...styles.cell }}><div style={styles.flexCell}></div></td>
                                <td style={{ ...styles.cell, fontWeight: 'bold' }}><div style={styles.flexCell}>{totalPcs.toFixed(0)}</div></td>
                                <td style={styles.cell}><div style={styles.flexCell}>{totalKg > 0 ? totalKg.toFixed(1) : '---'}</div></td>
                                <td style={styles.cell}><div style={styles.flexCell}><div style={styles.verificaGrid}><div style={styles.verificaSlot}></div><div style={styles.verificaSlot}></div><div style={{ flex: 1 }}></div></div></div></td>
                                <td style={styles.cell}><div style={styles.flexCell}>□</div></td>
                                {i === 0 && (
                                    <td rowSpan={tubiItems.length} style={{ ...styles.cell, fontWeight: 'bold', fontSize: '11pt', backgroundColor: 'white' }}>
                                        <div style={styles.flexCell}>{getEstimatedTimeForSection('phase-template-7')}</div>
                                    </td>
                                )}
                            </tr>
                        )
                    })}
                    <tr style={styles.spacingRow}><td colSpan={7}></td></tr>
                </>
            )}

            {guainaItems.length > 0 && (
                <>
                    <tr style={{ backgroundColor: 'white', fontWeight: 'bold', fontSize: '7pt' }}>
                        <td style={styles.cell}><div style={styles.flexCell}>GUAINA</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>L TAGLIO mm</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>QT</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>Mt. Guaina</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>Verifica misura mm</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>Completato</div></td>
                        <td style={styles.cell}><div style={styles.flexCell}>Tempo Previsto (hh:mm)</div></td>
                    </tr>
                    {guainaItems.map((item, i) => {
                        const totalPcs = item.quantity * job.qta;
                        const totalMt = item.lunghezzaTaglioMm ? (totalPcs * item.lunghezzaTaglioMm / 1000) : 0;
                        return (
                            <tr key={`g-${i}`} style={{ height: '9mm', backgroundColor: styles.bgGuaina }}>
                                <td style={{ ...styles.cell, textAlign: 'left' }}><div style={{...styles.flexCell, justifyContent: 'flex-start', paddingLeft: '4px'}}>{item.component}</div></td>
                                <td style={{ ...styles.cell, fontWeight: 'bold' }}><div style={styles.flexCell}>{item.lunghezzaTaglioMm || '0'}</div></td>
                                <td style={{ ...styles.cell, fontWeight: 'bold' }}><div style={styles.flexCell}>{totalPcs.toFixed(0)}</div></td>
                                <td style={{ ...styles.cell, fontWeight: 'bold' }}><div style={styles.flexCell}>{totalMt.toFixed(2)}</div></td>
                                <td style={styles.cell}><div style={styles.flexCell}><div style={styles.verificaGrid}><div style={styles.verificaSlot}></div><div style={styles.verificaSlot}></div><div style={{ flex: 1 }}></div></div></div></td>
                                <td style={styles.cell}><div style={styles.flexCell}>□</div></td>
                                {i === 0 && (
                                    <td rowSpan={guainaItems.length} style={{ ...styles.cell, fontWeight: 'bold', fontSize: '11pt', backgroundColor: 'white' }}>
                                        <div style={styles.flexCell}>{getEstimatedTimeForSection('phase-template-6')}</div>
                                    </td>
                                )}
                            </tr>
                        )
                    })}
                </>
            )}

            <tr style={styles.spacingRow}><td colSpan={7}></td></tr>

            <tr style={{ height: '10mm' }}>
              <td style={{ ...styles.cell, backgroundColor: "#fff3e0", fontWeight: 'bold', verticalAlign: 'top', textAlign: 'left', padding: '2mm' }} colSpan={4}>Segnalazione Operatore (note - NC)</td>
              <td style={{ ...styles.cell, backgroundColor: styles.headerGray, fontWeight: 'bold', verticalAlign: 'top', textAlign: 'left', padding: '2mm' }} colSpan={3}>Data e Firma Operatore</td>
            </tr>
            <tr style={{ height: '10mm', backgroundColor: 'white' }}>
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
    </div>
  );
}
