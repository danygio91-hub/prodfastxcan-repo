import React from 'react';
import QRCode from 'react-qr-code';
import { format, isValid, parseISO } from 'date-fns';
import type { JobOrder, RawMaterial, Article } from '@/lib/mock-data';
import { ODLConfig, DEFAULT_ODL_CONFIG } from '@/lib/odl-config';

interface ODLPrintTemplateProps {
  job: JobOrder;
  article: Article | null;
  materials: RawMaterial[];
  printDate?: Date;
  config?: ODLConfig;
  qrRule?: string;
}

export default function ODLPrintTemplate({ 
  job, 
  article, 
  materials, 
  printDate, 
  config = DEFAULT_ODL_CONFIG,
  qrRule = "{ordinePF}@{details}@{qta}"
}: ODLPrintTemplateProps) {
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
      pageBreakAfter: "always" as const,
    },
    masterTable: {
      width: "100%",
      borderCollapse: "collapse" as const,
      tableLayout: "fixed" as const,
      border: `1.5px solid ${config.colors.border}`,
    },
    cell: {
      border: `1px solid ${config.colors.border}`,
      padding: "0",
      fontSize: `${config.typography.baseFontSize}pt`,
      height: "8.5mm",
      verticalAlign: (config.layout.verticalAlign || "middle") as any,
      textAlign: (config.layout.textAlign || "center") as any,
      lineHeight: "1",
      position: "relative" as const,
    },
    label: {
        fontSize: `${config.typography.headerFontSize}pt`,
        fontWeight: "bold" as const,
        color: config.colors.headerText || "#555",
        textAlign: "center" as const,
        marginBottom: "1px",
    },
    title: {
      backgroundColor: config.colors.primary,
      color: "white",
      fontWeight: "bold" as const,
      fontSize: `${config.typography.titleFontSize}pt`,
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
        padding: '2mm',
        boxSizing: 'border-box' as const,
    },
    qrInner: {
        backgroundColor: 'white',
        padding: '1mm',
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
        borderRight: `1px solid ${config.colors.border}`,
    },
    valueLarge: {
        fontSize: "12pt", // Slightly smaller but bold
        fontWeight: "bold" as const,
    },
    spacingRow: {
        height: "3mm",
        backgroundColor: "white",
        border: "none",
    }
  };

  const getCellFlexStyles = (colConfig?: any) => {
    const vAlign = colConfig?.verticalAlign || config.layout.verticalAlign || 'middle';
    const hAlign = colConfig?.textAlign || config.layout.textAlign || 'center';
    
    return {
      display: "flex",
      alignItems: vAlign === 'top' ? 'flex-start' : vAlign === 'bottom' ? 'flex-end' : 'center',
      justifyContent: hAlign === 'left' ? 'flex-start' : hAlign === 'right' ? 'flex-end' : 'center',
      height: "100%",
      width: "100%",
      padding: `${config.layout.cellPadding || 0}px`,
      boxSizing: "border-box" as const,
    };
  };

  // NORMALIZED GRID: 10 Columns
  const GRID_COLS = 10;
  const colWidth = 100 / GRID_COLS;

  const activeHeaderCols = config.header.columns?.filter(c => c.visible) || [];

  const renderHeader = () => {
    const logoSrc = config.header.logoBase64 || config.header.logoUrl;

    return (
      <div style={{ marginBottom: '3mm', position: 'relative' }}>
        {/* Revision Info - Independent Top Right */}
        {config.header.showRevInfo && (
            <div style={{ 
                position: 'absolute', 
                top: '-2mm', 
                right: '0', 
                fontSize: '6pt', 
                color: '#666',
                fontStyle: 'italic'
            }}>
                {config.header.revText}
            </div>
        )}

        <table style={{ ...styles.masterTable }}>
            <colgroup>
                <col width={`calc(100% - ${config.header.qrColumnWidth || '15%'})`} />
                <col width={config.header.qrColumnWidth || '15%'} />
            </colgroup>
            <tbody>
                <tr>
                    <td style={{ padding: 0, verticalAlign: 'top', borderRight: `1.5px solid ${config.colors.border}` }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                            <colgroup>
                                <col width={config.header.logoColumnWidth || '23.5%'} />
                                <col width={`calc(100% - ${config.header.logoColumnWidth || '23.5%'})`} />
                            </colgroup>
                            <tbody>
                                <tr>
                                    <td style={{ ...styles.cell, borderLeft: 0, borderTop: 0, borderBottom: 0, backgroundColor: config.header.logoBg || 'white' }}>
                                        <div style={styles.qrWrapper}>
                                            {logoSrc && <img src={logoSrc} alt="Logo" style={{ height: `${config.header.logoHeight}px`, maxWidth: '95%', objectFit: 'contain' }} />}
                                        </div>
                                    </td>
                                    <td style={{ ...styles.title, border: 0, borderLeft: `1px solid ${config.colors.border}`, backgroundColor: config.header.titleBg || config.colors.primary, height: config.header.titleHeight || '12mm' }}>
                                        <div style={getCellFlexStyles()}>{config.header.title}</div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', borderTop: `1px solid ${config.colors.border}` }}>
                          <colgroup>
                            {activeHeaderCols.map((col) => (
                              <col key={col.id} width={col.width || `${100 / activeHeaderCols.length}%`} />
                            ))}
                          </colgroup>
                          <tbody>
                            {/* HEADER LABELS */}
                            <tr style={{ backgroundColor: config.colors.headerBg }}>
                              {activeHeaderCols.map((col, idx) => (
                                <td key={col.id} style={{ ...styles.cell, borderTop: 0, borderBottom: 0, borderLeft: idx === 0 ? 0 : `1px solid ${config.colors.border}`, borderRight: idx === activeHeaderCols.length - 1 ? 0 : `1px solid ${config.colors.border}`, fontSize: `${col.fontSize || config.typography.headerFontSize}pt` }}>
                                  <div style={styles.label}>{col.label}</div>
                                </td>
                              ))}
                            </tr>
                            {/* HEADER VALUES */}
                            <tr style={{ fontWeight: 'bold', fontSize: '11pt' }}>
                              {activeHeaderCols.map((col, idx) => {
                                let val = '---';
                                if (col.field === 'reparto') val = getDeptSigla(job.department);
                                if (col.field === 'dataOdl') val = format(printDate || new Date(), 'dd/MM/yyyy');
                                if (col.field === 'ordinePf') val = job.ordinePF;
                                if (col.field === 'numeroOdl') val = job.numeroODLInterno || '---';

                                return (
                                  <td key={col.id} style={{ ...styles.cell, borderLeft: idx === 0 ? 0 : `1px solid ${config.colors.border}`, borderRight: idx === activeHeaderCols.length - 1 ? 0 : `1px solid ${config.colors.border}`, borderBottom: 0, fontSize: `${col.fontSize || 11}pt`, backgroundColor: col.field === 'reparto' || col.field === 'ordinePf' || col.field === 'numeroOdl' ? config.colors.bgValueGreen : 'white' }}>
                                    <div style={getCellFlexStyles(col)}>{val}</div>
                                  </td>
                                );
                              })}
                            </tr>
                          </tbody>
                        </table>
                    </td>
                    <td style={{ padding: 0, verticalAlign: 'top', backgroundColor: 'white' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                            <div style={{ backgroundColor: config.header.qrTitleBg || config.colors.primary, color: 'white', fontSize: '6.5pt', fontWeight: 'bold', textAlign: 'center', padding: '1mm', borderBottom: `1px solid ${config.colors.border}`, flex: '0 0 auto', height: config.header.qrTitleHeight || '6mm', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                CODICE COMMESSA
                            </div>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1mm' }}>
                                <QRCode value={
                                  (qrRule || "{ordinePF}@{details}@{qta}")
                                  .replace('{ordinePF}', job.ordinePF || '')
                                  .replace('{details}', job.details || '')
                                  .replace('{qta}', String(job.qta || ''))
                                  .replace('{numeroODLInterno}', job.numeroODLInterno || '')
                                } size={config.header.qrSize || 65} />
                            </div>
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
      </div>
    );
  };

  const renderJobDetails = () => {
    const activeInfoCols = config.info.columns.filter(c => c.visible);
    const rowCount = activeInfoCols.length || 1;
    
    // Label and Value widths from config. The rest for Drawing.
    const labelW = config.info.labelWidth || '15%';
    const valueW = config.info.valueWidth || '25%';
    
    // Convert percentages to numbers to calculate remaining
    const lVal = parseFloat(labelW);
    const vVal = parseFloat(valueW);
    const drawW = 100 - lVal - vVal; // Full remaining width 

    return (
      <div style={{ marginBottom: '3mm' }}>
        <table style={styles.masterTable}>
          <colgroup>
              <col width={labelW} />
              <col width={valueW} />
              <col width={`${drawW}%`} />
          </colgroup>
          <tbody>
            {(activeInfoCols.length > 0 ? activeInfoCols : [{ id: 'empty', label: '-', field: '', visible: true }]).map((col, idx) => {
              let val = '---';
              if (col.field === 'cliente') val = job.cliente;
              if (col.field === 'details') val = job.details;
              if (col.field === 'qta') val = `${job.qta}`;
              if (col.field === 'dataConsegnaFinale') val = formatDateSafe(job.dataConsegnaFinale);

              return (
                <tr key={col.id} style={{ height: '8mm' }}>
                  {/* LABEL */}
                  <td style={{ ...styles.cell, backgroundColor: config.colors.headerBg, fontWeight: 'bold', fontSize: `${config.info.fontSize}pt` }}>
                      <div style={getCellFlexStyles()}>{col.label}</div>
                  </td>
                  {/* VALUE */}
                  <td style={{ ...styles.cell, backgroundColor: col.colorKey ? (config.colors as any)[col.colorKey] : 'white', fontWeight: 'bold', fontSize: `${config.info.fontSize + 2}pt` }}>
                    <div style={getCellFlexStyles()}>{val}</div>
                  </td>

                  {/* DRAWING / NOTES AREA */}
                  {idx === 0 && (
                    <td style={{ ...styles.cell, color: config.colors.drawingAreaText, fontWeight: 'bold', fontSize: '18pt', backgroundColor: config.colors.drawingAreaBg, textAlign: 'center', verticalAlign: 'middle', borderLeft: `1.5px solid ${config.colors.border}` }} rowSpan={rowCount}>
                      <div style={getCellFlexStyles()}>{config.layout.showDrawingArea ? config.layout.drawingAreaText : ''}</div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderSectionHeader = () => (
    <table style={{ ...styles.masterTable, marginBottom: '0' }}>
      <tbody>
        <tr>
          <td style={{ ...styles.cell, backgroundColor: config.colors.tableHeaderBg, color: config.colors.tableHeaderText, height: "6mm", border: `1.5px solid ${config.colors.border}` }}>
            <div style={getCellFlexStyles()}>PREPARAZIONE COMPONENTI {config.layout.splitByCategoryThreshold < allItems.length ? "(CONTINUA)" : ""}</div>
          </td>
        </tr>
      </tbody>
    </table>
  );

  const renderTableRows = (items: any[], columnConfigs: any[], sectionType: 'treccia' | 'tubi' | 'guaina') => {
    const visibleCols = columnConfigs.filter(c => c.visible);
    if (items.length === 0) return null;

    return (
      <table style={{ ...styles.masterTable, borderTop: '0' }}>
        <colgroup>
          {visibleCols.map((col) => (
            <col key={col.id} width={col.width} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ backgroundColor: config.colors.tableHeaderBg, color: config.colors.tableHeaderText, fontWeight: 'bold', fontSize: '7pt' }}>
            {visibleCols.map((col) => (
              <td key={col.id} style={styles.cell}>
                <div style={getCellFlexStyles(col)}>{col.label}</div>
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const totalUnits = item.quantity * job.qta;
            const factor = item.mat?.rapportoKgMt || item.mat?.conversionFactor || 0;
            
            const data: any = {
              codice: item.component,
              lunghezzaTaglio: item.lunghezzaTaglioMm || 0,
              quantita: totalUnits,
              pesoTotale: ((item.lunghezzaTaglioMm ? (item.lunghezzaTaglioMm / 1000) : 1) * totalUnits * factor).toFixed(1),
              metriTotali: (item.lunghezzaTaglioMm ? (totalUnits * item.lunghezzaTaglioMm / 1000) : 0).toFixed(2),
              placeholder: '',
              checkbox: '□',
              tempoPrevisto: '',
              note: item.note || ''
            };

            return (
              <tr key={`${sectionType}-${i}`} style={{ height: '9mm', backgroundColor: sectionType === 'treccia' ? config.colors.bgTreccia : sectionType === 'tubi' ? config.colors.bgTubi : config.colors.bgGuaina }}>
                {visibleCols.map((col) => {
                  const isTempoPrevisto = col.field === 'tempoPrevisto';
                  const cellFontSize = col.fontSize || config.typography.baseFontSize;
                  
                  if (isTempoPrevisto) {
                    if (i === 0) {
                      return (
                        <td key={col.id} rowSpan={items.length} style={{ ...styles.cell, fontWeight: 'bold', fontSize: `${cellFontSize}pt`, backgroundColor: 'white' }}>
                          <div style={getCellFlexStyles(col)}>
                              {config.layout.showEstimatedTimes ? getEstimatedTimeForSection(
                                  sectionType === 'treccia' ? 'phase-template-1' : 
                                  sectionType === 'tubi' ? 'phase-template-7' : 'phase-template-6'
                              ) : '---'}
                          </div>
                        </td>
                      );
                    }
                    return null;
                  }

                  // Conditional rendering for notes: only show if present
                  const displayValue = col.field === 'note' ? (data.note || '') : (data[col.field] ?? '---');

                  return (
                    <td key={col.id} style={{ ...styles.cell, fontSize: `${cellFontSize}pt` }}>
                      <div style={getCellFlexStyles(col)}>
                        {col.field === 'placeholder' ? (
                          <div style={styles.verificaGrid}><div style={styles.verificaSlot}></div><div style={styles.verificaSlot}></div><div style={{ flex: 1 }}></div></div>
                        ) : displayValue}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const renderFooter = () => (
    <table style={{ ...styles.masterTable, marginTop: '3mm' }}>
      <tbody>
        <tr style={{ height: '10mm' }}>
          <td style={{ ...styles.cell, backgroundColor: config.colors.footerBg, color: config.colors.footerText, fontWeight: 'bold', padding: '2mm' }} colSpan={6}>
              <div style={getCellFlexStyles({ textAlign: 'left', verticalAlign: 'top' })}>NOTE / NON CONFORMITÀ (NC)</div>
          </td>
          <td style={{ ...styles.cell, backgroundColor: config.colors.headerBg, color: config.colors.headerText || "#555", fontWeight: 'bold', padding: '2mm' }} colSpan={4}>
              <div style={getCellFlexStyles({ textAlign: 'left', verticalAlign: 'top' })}>DATA E FIRMA OPERATORE</div>
          </td>
        </tr>
        <tr style={{ height: '10mm', backgroundColor: 'white' }}>
          <td style={styles.cell} colSpan={6}></td>
          <td style={{ ...styles.cell, padding: '4mm' }} colSpan={4}>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'flex-end', height: '100%', paddingBottom: '1mm', fontSize: '7.5pt' }}>
                <span style={{ fontWeight: 'bold' }}>DATA: ___/___/______</span>
                <span style={{ fontWeight: 'bold' }}>FIRMA: ___________________________________</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );

  const totalItemsRows = trecciaItems.length + tubiItems.length + guainaItems.length;
  const shouldSplit = totalItemsRows > config.layout.splitByCategoryThreshold && (
      (trecciaItems.length > 0 && tubiItems.length > 0) || 
      (trecciaItems.length > 0 && guainaItems.length > 0) || 
      (tubiItems.length > 0 && guainaItems.length > 0)
  );

  if (shouldSplit) {
    return (
      <div id="odl-pdf-pages" style={{ width: '297mm' }}>
        {trecciaItems.length > 0 && (
          <div className="odl-page" style={styles.page}>
            <table style={styles.masterTable}>
              {renderHeader()}
              {renderJobDetails()}
              {renderSectionHeader()}
              {renderTableRows(trecciaItems, config.columns.treccia, 'treccia')}
              {renderFooter()}
            </table>
          </div>
        )}
        {tubiItems.length > 0 && (
          <div className="odl-page" style={styles.page}>
            <table style={styles.masterTable}>
              {renderHeader()}
              {renderJobDetails()}
              {renderSectionHeader()}
              {renderTableRows(tubiItems, config.columns.tubi, 'tubi')}
              {renderFooter()}
            </table>
          </div>
        )}
        {guainaItems.length > 0 && (
          <div className="odl-page" style={styles.page}>
            <table style={styles.masterTable}>
              {renderHeader()}
              {renderJobDetails()}
              {renderSectionHeader()}
              {renderTableRows(guainaItems, config.columns.guaina, 'guaina')}
              {renderFooter()}
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="odl-pdf-pages" style={{ width: '297mm' }}>
      <div className="odl-page" style={styles.page}>
        <table style={styles.masterTable}>
          {renderHeader()}
          {renderJobDetails()}
          {renderSectionHeader()}
          {renderTableRows(trecciaItems, config.columns.treccia, 'treccia')}
          {renderTableRows(tubiItems, config.columns.tubi, 'tubi')}
          {renderTableRows(guainaItems, config.columns.guaina, 'guaina')}
          {renderFooter()}
        </table>
      </div>
    </div>
  );
}