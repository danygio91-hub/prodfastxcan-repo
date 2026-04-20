import React from 'react';
import QRCode from 'react-qr-code';
import { format, isValid, parseISO } from 'date-fns';
import type { JobOrder, RawMaterial, Article } from '@/types';
import { ODLConfig, DEFAULT_ODL_CONFIG } from '@/lib/odl-config';
import { calculateBOMRequirement } from '@/lib/inventory-utils';
import { GlobalSettings } from '@/lib/settings-types';

interface ODLPrintTemplateProps {
  job: JobOrder;
  article: Article | null;
  materials: RawMaterial[];
  printDate?: Date;
  config?: ODLConfig;
  qrRule?: string;
  globalSettings?: GlobalSettings | null;
}

export default function ODLPrintTemplate({ 
  job, 
  article, 
  materials, 
  printDate, 
  config = DEFAULT_ODL_CONFIG,
  qrRule = "{ordinePF}@{details}@{qta}",
  globalSettings
}: ODLPrintTemplateProps) {
  console.log("ODL Print Job Data:", {
    id: job.id,
    numeroODL: job.numeroODL,
    ordinePF: job.ordinePF,
    dataFinePreparazione: job.dataFinePreparazione,
    dataConsegnaFinale: job.dataConsegnaFinale
  });

  const materialsMap = new Map(materials.map(m => [m.code.toUpperCase(), m]));

  const allItems = (job.billOfMaterials || []).map(item => {
    const mat = materialsMap.get(item.component.toUpperCase());
    const type = mat?.type?.toUpperCase() || 'TRECCIA';
    
    // FALLBACK LOGIC: If job item has no notes, try to find them in the Article BOM
    let finalNote = (item.note || '').trim();
    if (!finalNote && article?.billOfMaterials) {
        const articleMatch = article.billOfMaterials.find(aItem => 
            aItem.component.toUpperCase().trim() === item.component.toUpperCase().trim() &&
            (aItem.lunghezzaTaglioMm || 0) === (item.lunghezzaTaglioMm || 0)
        );
        if (articleMatch?.note) {
            finalNote = articleMatch.note.trim();
        }
    }

    return { ...item, note: finalNote, type, mat };
  });

  const trecciaItems = allItems.filter(i => ['BOB', 'PF3V0', 'BARRA', 'TRECCIA'].includes(i.type));
  const tubiItems = allItems.filter(i => i.type === 'TUBI');
  const guainaItems = allItems.filter(i => i.type === 'GUAINA');

  const hasTrecciaNotes = trecciaItems.some(i => i.note && i.note.trim() !== '');
  const hasTubiNotes = tubiItems.some(i => i.note && i.note.trim() !== '');
  const hasGuainaNotes = guainaItems.some(i => i.note && i.note.trim() !== '');

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
      const d = typeof dateInput === 'string' 
        ? (dateInput.includes('T') ? parseISO(dateInput) : new Date(dateInput))
        : (dateInput.toDate ? dateInput.toDate() : new Date(dateInput));
      
      return isValid(d) ? format(d, 'dd/MM/yyyy') : '---';
    } catch (e) { return '---'; }
  };

  const getEstimatedTimeForSection = (phaseId: string) => {
    const timeData = article?.phaseTimes?.[phaseId];
    if (!timeData || (!timeData.expectedMinutesPerPiece && !timeData.detectedMinutesPerPiece)) return 'N/D';
    const mins = timeData.expectedMinutesPerPiece || timeData.detectedMinutesPerPiece || 0;
    const totalMins = Math.round(mins * job.qta);
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
      position: "relative" as const,
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
      minHeight: "8.5mm",
      verticalAlign: (config.layout.verticalAlign || "middle") as any,
      textAlign: (config.layout.textAlign || "center") as any,
      lineHeight: "1.2",
      position: "relative" as const,
    },
    label: {
        fontSize: `${config.typography.headerFontSize}pt`,
        fontWeight: "bold" as const,
        color: config.colors.headerText || "#555",
        textAlign: "center" as const,
    },
    title: {
      backgroundColor: config.colors.primary,
      color: "white",
      fontWeight: "bold" as const,
      fontSize: `${config.typography.titleFontSize}pt`,
      textAlign: "center" as const,
      height: config.header.titleHeight || "12mm",
      position: "relative" as const,
    },
    qrWrapper: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%',
        padding: '1mm',
        boxSizing: 'border-box' as const,
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
        fontSize: "12pt",
        fontWeight: "bold" as const,
    },
    pageNumber: {
        position: 'absolute' as const,
        bottom: '5mm',
        right: '5mm',
        fontSize: '9pt',
        fontWeight: 'bold' as const,
        backgroundColor: '#000',
        color: '#fff',
        padding: '1mm 3mm',
        borderRadius: '1mm',
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
      whiteSpace: "normal" as any,
      wordBreak: "break-word" as any,
      padding: `${config.layout.cellPadding || 0}px`,
      boxSizing: "border-box" as const,
    };
  };

  const activeHeaderCols = config.header.columns?.filter(c => c.visible) || [];

  const renderHeader = (isContinuation: boolean = false) => {
    const logoSrc = config.header.logoBase64 || config.header.logoUrl;
    
    // Minimalist header for continuation pages
    if (isContinuation) {
        return (
            <div style={{ marginBottom: '2mm' }}>
                <table style={{ ...styles.masterTable }}>
                    <colgroup>
                        <col width="15%" />
                        <col width="50%" />
                        <col width="35%" />
                    </colgroup>
                    <tbody>
                        <tr>
                            <td style={{ ...styles.cell, borderBottom: 0, padding: '1mm' }}>
                                {logoSrc && <img src={logoSrc} alt="Logo" style={{ height: '8mm', objectFit: 'contain' }} />}
                            </td>
                            <td style={{ ...styles.cell, borderBottom: 0, backgroundColor: config.colors.primary, color: 'white', fontWeight: 'bold', fontSize: '10pt' }}>
                                SCHEDA DI LAVORAZIONE - CONTINUAZIONE
                            </td>
                            <td style={{ ...styles.cell, borderBottom: 0, fontWeight: 'bold', fontSize: '10pt' }}>
                                ODL: {job.numeroODLInterno || '---'} | PF: {job.ordinePF}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        );
    }

    return (
      <div style={{ marginBottom: '3mm', position: 'relative' }}>
        <div style={{ 
            position: 'absolute', 
            top: '-4mm', 
            right: '0', 
            fontSize: '7pt', 
            color: '#333',
            fontWeight: 'bold'
        }}>
            {config.header.showRevInfo && <span>{config.header.revText}</span>}
        </div>

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
                            <tr style={{ backgroundColor: config.colors.headerBg }}>
                              {activeHeaderCols.map((col, idx) => (
                                <td key={col.id} style={{ ...styles.cell, borderTop: 0, borderBottom: 0, borderLeft: idx === 0 ? 0 : `1px solid ${config.colors.border}`, borderRight: idx === activeHeaderCols.length - 1 ? 0 : `1px solid ${config.colors.border}`, fontSize: `${col.fontSize || config.typography.headerFontSize}pt` }}>
                                  <div style={{ ...getCellFlexStyles(), ...styles.label }}>{col.label}</div>
                                </td>
                              ))}
                            </tr>
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

  const renderJobDetails = (showDrawingArea: boolean = true) => {
    // 1. Resolve Colors Helper
    const resolveColBg = (colorKey?: string) => {
      if (!colorKey || colorKey === 'white') return 'white';
      // Use any to bypass strict type checking for dynamic keys
      const colors = config.colors as any;
      const defaults = DEFAULT_ODL_CONFIG.colors as any;
      return colors[colorKey] || defaults[colorKey] || 'white';
    };

    // 2. Extreme Sanitization & Deduplication
    // We want to build a clean list of rows that matches the designer but is immune to DB corruption
    const sanitizedRows: any[] = [];
    const seenFields = new Set<string>();
    const seenDateLabels = new Set<string>();

    config.info.columns.forEach(col => {
      if (!col.visible) return;

      const normalizedLabel = col.label.toUpperCase();
      const isPrepDate = col.field === 'dataFinePreparazione' || normalizedLabel.includes('FINE PREPARAZIONE');
      const isFinalDate = col.field === 'dataConsegnaFinale' || col.field === 'dataConsegnaCliente' || normalizedLabel.includes('CONSEGNA FINALE');

      // Deduplicate: If we already handled this logical field, skip
      if (isPrepDate) {
        if (seenDateLabels.has('PREP')) return;
        seenDateLabels.add('PREP');
      } else if (isFinalDate) {
        if (seenDateLabels.has('FINAL')) return;
        seenDateLabels.add('FINAL');
      } else {
        if (seenFields.has(col.field)) return;
        seenFields.add(col.field);
      }

      // 3. Precise Data Mapping
      let val = '---';
      if (col.field === 'cliente') val = job.cliente || '---';
      else if (col.field === 'details') val = job.details || '---';
      else if (col.field === 'qta') val = `${job.qta || 0}`;
      else if (isPrepDate) val = formatDateSafe(job.dataFinePreparazione);
      else if (isFinalDate) val = formatDateSafe(job.dataConsegnaFinale);

      sanitizedRows.push({
        ...col,
        label: isPrepDate ? 'DATA FINE PREPARAZIONE MATERIALE' : (isFinalDate ? 'DATA CONSEGNA FINALE' : col.label),
        value: val
      });
    });

    const rowCount = sanitizedRows.length || 1;
    const labelW = config.info.labelWidth || '15%';
    const valueW = config.info.valueWidth || '25%';
    const drawW = 100 - parseFloat(labelW) - parseFloat(valueW);

    const renderDrawingArea = () => (
      <td style={{ ...styles.cell, color: config.colors.drawingAreaText, fontWeight: 'bold', fontSize: '18pt', backgroundColor: config.colors.drawingAreaBg, textAlign: 'center', verticalAlign: 'middle', borderLeft: `1.5px solid ${config.colors.border}`, height: config.layout.drawingAreaHeight || '40mm' }} rowSpan={rowCount}>
        <div style={{ ...getCellFlexStyles(), flexDirection: 'column', gap: '2mm' }}>
          <div>{config.layout.showDrawingArea ? config.layout.drawingAreaText : ''}</div>
          {job.attachments && job.attachments.length > 0 && (
            <div style={{ fontSize: '7.5pt', color: '#555', textAlign: 'left', width: '90%', marginTop: 'auto', borderTop: '1px dashed #ccc', paddingTop: '2mm' }}>
              <div style={{ textTransform: 'uppercase', marginBottom: '1mm', color: '#000', fontSize: '8pt' }}>📄 Documentazione MES:</div>
              {job.attachments.map((att, i) => (
                <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  • {att.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </td>
    );

    return (
      <div style={{ marginBottom: '3mm' }}>
        <table style={styles.masterTable}>
          <colgroup>
              <col width={labelW} />
              <col width={valueW} />
              <col width={`${drawW}%`} />
          </colgroup>
          <tbody>
            {sanitizedRows.length > 0 ? sanitizedRows.map((row, idx) => (
              <tr key={row.id || idx} style={{ height: '8.5mm' }}>
                <td style={{ ...styles.cell, backgroundColor: config.colors.headerBg, fontWeight: 'bold', fontSize: `${config.info.fontSize}pt` }}>
                    <div style={getCellFlexStyles()}>{row.label}</div>
                </td>
                <td style={{ ...styles.cell, backgroundColor: resolveColBg(row.colorKey), fontWeight: 'bold', fontSize: `${config.info.fontSize + 2}pt` }}>
                  <div style={getCellFlexStyles()}>{row.value}</div>
                </td>
                {idx === 0 && renderDrawingArea()}
              </tr>
            )) : (
              <tr style={{ height: '8.5mm' }}>
                 <td style={styles.cell} colSpan={2}><div style={getCellFlexStyles()}>--- NESSUNA INFORMAZIONE VISIBILE ---</div></td>
                 {renderDrawingArea()}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const renderSectionHeader = (typeStr: string, isContinuation: boolean = false) => (
    <table style={{ ...styles.masterTable, marginBottom: '0' }}>
      <tbody>
        <tr>
          <td style={{ ...styles.cell, backgroundColor: config.colors.tableHeaderBg, color: config.colors.tableHeaderText, height: "6mm", border: `1.5px solid ${config.colors.border}`, fontWeight: 'bold' }}>
            <div style={getCellFlexStyles()}>PREPARAZIONE {typeStr.toUpperCase()} {isContinuation ? "(CONTINUA)" : ""}</div>
          </td>
        </tr>
      </tbody>
    </table>
  );

  const renderTableRows = (items: any[], columnConfigs: any[], sectionType: 'treccia' | 'tubi' | 'guaina', hasAnyNoteSection: boolean) => {
    if (items.length === 0) return null;

    const hasAnyNote = hasAnyNoteSection;
    let visibleCols = [...columnConfigs.filter(c => c.visible)];

    // DYNAMIC INJECTION: If BOM has notes, inject the column and adjust widths
    const existingNoteIdx = visibleCols.findIndex(c => c.field === 'note');
    
    if (hasAnyNote && existingNoteIdx === -1) {
        const tempoIdx = visibleCols.findIndex(c => c.field === 'tempoPrevisto');
        
        // Define Dynamic Note Column
        const noteCol = { 
            id: 'note-dynamic', 
            label: 'NOTE', 
            field: 'note', 
            width: '15%', 
            visible: true,
            textAlign: 'left' as const,
            fontSize: 7
        };

        if (tempoIdx !== -1) {
            // Adjust widths to accommodate the 15% for NOTE
            visibleCols = visibleCols.map(c => {
                // 1. Shrink Tempo Previsto (20% -> 10%)
                if (c.field === 'tempoPrevisto') return { ...c, width: '10%' };
                // 2. Shrink Main Column (20% -> 15%)
                if (c.field === 'codice') return { ...c, width: '15%' };
                return c;
            });
            // 3. Insert NOTE exactly before Tempo Previsto
            visibleCols.splice(tempoIdx, 0, noteCol);
        } else {
            visibleCols.push(noteCol);
        }
    } else if (!hasAnyNote && existingNoteIdx !== -1) {
        // Fallback: If no notes but column is in config, remove and redistribute
        const removedWidth = parseFloat(visibleCols[existingNoteIdx].width) || 0;
        visibleCols = visibleCols.filter(c => c.field !== 'note');
        if (visibleCols.length > 0 && removedWidth > 0) {
            const extra = removedWidth / visibleCols.length;
            visibleCols = visibleCols.map(c => ({
                ...c,
                width: `${(parseFloat(c.width) || 0) + extra}%`
            }));
        }
    }

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
            const configMat = globalSettings?.rawMaterialTypes.find(t => t.id === item.mat?.type) || { defaultUnit: item.mat?.unitOfMeasure };
            const req = calculateBOMRequirement(job.qta, item, item.mat as any, configMat as any);
            
            const data: any = {
              codice: item.component,
              lunghezzaTaglio: item.lunghezzaTaglioMm || 0,
              quantita: req.totalPieces,
              pesoTotale: req.weightKg.toFixed(1),
              metriTotali: req.totalMeters?.toFixed(2) || '0.00',
              placeholder: '',
              checkbox: '□',
              tempoPrevisto: '',
              note: item.note || ''
            };

            return (
              <tr key={`${sectionType}-${i}`} style={{ minHeight: '9.2mm', backgroundColor: sectionType === 'treccia' ? config.colors.bgTreccia : sectionType === 'tubi' ? config.colors.bgTubi : config.colors.bgGuaina }}>
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
    <table style={{ ...styles.masterTable, marginTop: '2mm' }}>
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

  // --- PAGINATION LOGIC V2 ---
  // --- DYNAMIC PAGINATION LOGIC (Smart Hybrid Strategy) ---
  
  type RenderBlock = 
    | { type: 'category-header'; categoryName: string; sectionType: 'treccia' | 'tubi' | 'guaina'; isContinuation: boolean }
    | { type: 'item-row'; item: any; sectionType: 'treccia' | 'tubi' | 'guaina'; colConfig: any[] };

  const allBlocks: RenderBlock[] = [];
  const trecciaCount = trecciaItems.length;
  const tubiCount = tubiItems.length;
  const guainaCount = guainaItems.length;
  const totalRows = trecciaCount + tubiCount + guainaCount;

  // Rule: Small orders fit on one page. Large orders separate by category.
  const STRATEGY = totalRows <= 7 ? 'UNIFIED' : 'ORGANIZED';

  const addCategoryToBlocks = (items: any[], categoryName: string, sectionType: 'treccia' | 'tubi' | 'guaina', colConfig: any[]) => {
    if (items.length === 0) return;
    allBlocks.push({ type: 'category-header', categoryName, sectionType, isContinuation: false });
    items.forEach(item => {
      allBlocks.push({ type: 'item-row', item, sectionType, colConfig });
    });
  };

  addCategoryToBlocks(trecciaItems, 'Componenti Treccia/Corda', 'treccia', config.columns.treccia);
  addCategoryToBlocks(tubiItems, 'Componenti Tubi', 'tubi', config.columns.tubi);
  addCategoryToBlocks(guainaItems, 'Componenti Guaina', 'guaina', config.columns.guaina);

  // Pagination Constants
  const FIRST_PAGE_ROW_LIMIT = 7;
  const SUBSEQUENT_PAGE_ROW_LIMIT = 17;

  const pages: RenderBlock[][] = [];
  let currentPage: RenderBlock[] = [];
  let currentRowCount = 0;
  let isFirstPage = true;

  allBlocks.forEach((block) => {
    const limit = isFirstPage ? FIRST_PAGE_ROW_LIMIT : SUBSEQUENT_PAGE_ROW_LIMIT;
    let shouldBreak = currentRowCount >= limit;

    // STRATEGY: ORGANIZED -> Force break before category header (except first)
    if (STRATEGY === 'ORGANIZED' && block.type === 'category-header' && !block.isContinuation && allBlocks.indexOf(block) > 0) {
        shouldBreak = true;
    }
    
    if (shouldBreak) {
        if (currentPage.length > 0) {
            pages.push(currentPage);
        }
        currentPage = [];
        currentRowCount = 0;
        isFirstPage = false;

        // Continuation logic: if we broke on a row, add the header on the new page
        if (block.type === 'item-row') {
            currentPage.push({ 
                type: 'category-header', 
                categoryName: block.sectionType === 'treccia' ? 'Componenti Treccia/Corda' : block.sectionType === 'tubi' ? 'Componenti Tubi' : 'Componenti Guaina', 
                sectionType: block.sectionType, 
                isContinuation: true 
            });
            currentRowCount++;
        }
    }

    currentPage.push(block);
    currentRowCount++;
  });

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  // Fallback for empty BOM
  if (pages.length === 0) {
    pages.push([{ type: 'category-header', categoryName: 'Distinta Base', sectionType: 'treccia', isContinuation: false }]);
  }

  return (
    <div id="odl-pdf-pages" style={{ width: '297mm' }}>
      {pages.map((pageBlocks, idx) => {
        const isFirstPageOfDoc = idx === 0;
        const isLastPageOfDoc = idx === pages.length - 1;

        return (
          <div key={idx} className="odl-page" style={styles.page}>
             {renderHeader(!isFirstPageOfDoc)}
             {isFirstPageOfDoc && renderJobDetails(true)}
             
             <div style={{ flex: 1 }}>
                {/* Render the stream of blocks for this page with grouping for tables */}
                {(() => {
                    const elements: React.ReactNode[] = [];
                    let currentTableRows: any[] = [];
                    let currentTableConfig: any[] = [];
                    let currentTableType: 'treccia' | 'tubi' | 'guaina' | null = null;

                    const flushTable = () => {
                        if (currentTableRows.length > 0 && currentTableType) {
                            const sectionHasNotes = currentTableType === 'treccia' ? hasTrecciaNotes : 
                                                  currentTableType === 'tubi' ? hasTubiNotes : hasGuainaNotes;
                            const tableEl = renderTableRows(currentTableRows, currentTableConfig, currentTableType, sectionHasNotes);
                            if (tableEl) {
                                elements.push(React.cloneElement(tableEl as React.ReactElement, { key: `table-${elements.length}` }));
                            }
                            currentTableRows = [];
                            currentTableType = null;
                        }
                    };

                    pageBlocks.forEach((block, bIdx) => {
                        if (block.type === 'category-header') {
                            flushTable();
                            const headerEl = renderSectionHeader(block.categoryName, block.isContinuation);
                            if (headerEl) {
                                elements.push(React.cloneElement(headerEl as React.ReactElement, { key: `header-${bIdx}` }));
                            }
                        } else {
                            if (currentTableType && currentTableType !== block.sectionType) {
                                flushTable();
                            }
                            currentTableType = block.sectionType as any;
                            currentTableConfig = block.colConfig;
                            currentTableRows.push(block.item);
                        }
                    });

                    flushTable();
                    return elements;
                })()}
             </div>

             {isLastPageOfDoc && renderFooter()}
             
             {/* Bottom Right Page Numbering (X/Y of Total) */}
             <div style={styles.pageNumber}>
                 PAGINA {idx + 1} DI {pages.length}
             </div>
          </div>
        );
      })}
    </div>
  );
}
