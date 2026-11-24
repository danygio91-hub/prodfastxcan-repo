import React from 'react';
import QRCode from 'react-qr-code';
import { format, isValid, parseISO } from 'date-fns';
import type { JobOrder, RawMaterial, Article, Department } from '@/types';
import { ODLConfig, DEFAULT_ODL_CONFIG } from '@/lib/odl-config';
import { calculateBOMRequirement } from '@/lib/inventory-utils';
import {
  findMaterialTypeConfig,
  GlobalSettings,
  resolveMaterialOdlSection,
} from '@/lib/settings-types';
import {
  paginateOdlSectionsByHeight,
  estimateInitialOdlPaginationInput,
  type OdlPaginatedPage,
  type OdlSectionType,
} from '@/lib/odl-pagination-logic';

interface ODLPrintTemplateProps {
  job: JobOrder;
  article: Article | null;
  materials: RawMaterial[];
  printDate?: Date;
  config?: ODLConfig;
  qrRule?: string;
  globalSettings?: GlobalSettings | null;
  departments?: Department[];
  /** FASE 88: Dizionari pre-compilati in memoria per lookup O(1) sincrono e puro */
  contoLavoroMap?: Record<string, string[]>;
  materialsByCode?: Record<string, RawMaterial>;
  articlesByCode?: Record<string, Article>;
  /** FASE 96: Permette il rendering simultaneo in batch dentro un unico container #odl-pdf-pages */
  omitRootId?: boolean;
}

const USABLE_PAGE_HEIGHT_MM = 197;

const PAGE_STATIC_STYLE: React.CSSProperties = {
  width: '297mm',
  height: '210mm',
  maxHeight: '210mm',
  padding: '6.5mm',
  backgroundColor: 'white',
  color: 'black',
  fontFamily: "'PT Sans', 'Calibri', sans-serif",
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  position: 'relative',
  pageBreakAfter: 'always',
};

const QR_WRAPPER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  width: '100%',
  padding: '1mm',
  boxSizing: 'border-box',
};

const VERIFICA_GRID_STYLE: React.CSSProperties = {
  display: 'flex',
  width: '100%',
  height: '100%',
  alignItems: 'stretch',
};

const VALUE_LARGE_STYLE: React.CSSProperties = {
  fontSize: '12pt',
  fontWeight: 'bold',
};

const PAGE_NUMBER_STYLE: React.CSSProperties = {
  position: 'absolute',
  bottom: '6.5mm',
  right: '6.5mm',
  fontSize: '9pt',
  fontWeight: 'bold',
  backgroundColor: '#000',
  color: '#fff',
  padding: '1mm 3mm',
  borderRadius: '1mm',
};

const ODL_ROOT_WRAPPER_STYLE: React.CSSProperties = { width: '297mm', position: 'relative' };

const MEASURE_ROOT_STYLE: React.CSSProperties = {
  position: 'absolute',
  visibility: 'hidden',
  pointerEvents: 'none',
  left: '-9999mm',
  top: 0,
  width: '284mm', // 297mm - 2 * 6.5mm safe zone
  zIndex: -9999,
  overflow: 'hidden',
};

const MEASURE_RULER_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '1px',
  height: `${USABLE_PAGE_HEIGHT_MM}mm`,
  pointerEvents: 'none',
};

const MEASURE_FLOW_ROOT_STYLE: React.CSSProperties = {
  display: 'flow-root',
  width: '100%',
};

function formatDateSafe(dateInput: any): string {
  if (!dateInput) return '---';
  try {
    const d =
      typeof dateInput === 'string'
        ? dateInput.includes('T')
          ? parseISO(dateInput)
          : new Date(dateInput)
        : dateInput.toDate
          ? dateInput.toDate()
          : new Date(dateInput);

    return isValid(d) ? format(d, 'dd/MM/yyyy') : '---';
  } catch (e) {
    return '---';
  }
}

const MemoizedQRCode = React.memo(function MemoizedQRCode({
  value,
  size,
}: {
  value: string;
  size: number;
}) {
  return <QRCode value={value} size={size} />;
});

function ODLPrintTemplate({ 
  job, 
  article, 
  materials, 
  printDate, 
  config = DEFAULT_ODL_CONFIG,
  qrRule = "{ordinePF}@{details}@{qta}",
  globalSettings,
  departments = [],
  contoLavoroMap,
  materialsByCode,
  articlesByCode,
  omitRootId = false,
}: ODLPrintTemplateProps) {
  const jobArticleKey = ((job as any).articolo || job.details || (job as any).articleCode || '').trim().toUpperCase();
  const resolvedArticle = article || (jobArticleKey && articlesByCode ? articlesByCode[jobArticleKey] || null : null);

  // FASE 88 & FASE 96: Costruzione dizionari/mappe in memoria solo se materialsByCode non è già fornito in O(1)
  const materialsMap = React.useMemo(() => {
    const map = new Map<string, RawMaterial>();
    if (materialsByCode) return map;
    for (const m of materials) {
      if (m?.code) {
        map.set(m.code.toUpperCase().trim(), m);
      }
      if (m?.id) {
        map.set(m.id.toUpperCase().trim(), m);
      }
    }
    return map;
  }, [materials, materialsByCode]);

  const jobContoLavoroList =
    contoLavoroMap?.[job.id] ??
    (job.ordinePF ? contoLavoroMap?.[job.ordinePF] : undefined) ??
    job.externalizedMaterials ??
    [];

  const contoLavoroSet = React.useMemo(
    () =>
      new Set<string>(
        jobContoLavoroList.map((m: string) => (m || '').toUpperCase().trim()).filter(Boolean)
      ),
    [jobContoLavoroList]
  );

  // Pre-indicizza le note della BOM Articolo in O(1) per evitare .find() nidificati (N*M)
  const articleBomNotesByKey = React.useMemo(() => {
    const byKey = new Map<string, string>();
    if (resolvedArticle?.billOfMaterials) {
      for (const aItem of resolvedArticle.billOfMaterials) {
        const compKey = (aItem.component || '').toUpperCase().trim();
        const cutKey = aItem.lunghezzaTaglioMm || 0;
        const cleanNote = (aItem.note || '').trim();
        if (compKey && cleanNote) {
          byKey.set(`${compKey}__${cutKey}`, cleanNote);
        }
      }
    }
    return byKey;
  }, [resolvedArticle?.billOfMaterials]);

  // Pre-indicizza i tipi di materia prima in O(1)
  const rawMaterialTypesMap = React.useMemo(() => {
    const map = new Map<string, any>();
    if (globalSettings?.rawMaterialTypes) {
      for (const t of globalSettings.rawMaterialTypes) {
        if (t?.id) {
          map.set(t.id, t);
        }
      }
    }
    return map;
  }, [globalSettings?.rawMaterialTypes]);

  // Pre-indicizza i reparti in O(1) per id / name / code
  const departmentCodeMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const d of departments) {
      const resolvedCode = d.code || d.name || d.id;
      if (!resolvedCode) continue;
      if (d.id) map.set(d.id, resolvedCode);
      if (d.name) map.set(d.name, resolvedCode);
      if (d.code) map.set(d.code, resolvedCode);
    }
    return map;
  }, [departments]);

  const sourceBom = React.useMemo(
    () =>
      job.billOfMaterials && job.billOfMaterials.length > 0
        ? job.billOfMaterials
        : (resolvedArticle?.billOfMaterials || []).map((b) => ({
            ...b,
            status: 'pending' as const,
            isFromTemplate: true,
          })),
    [job.billOfMaterials, resolvedArticle?.billOfMaterials]
  );

  const allItems = React.useMemo(
    () =>
      sourceBom.map((item) => {
        const compUpper = (item.component || '').toUpperCase().trim();
        const mat = materialsByCode?.[compUpper] ?? materialsMap.get(compUpper);
        // FASE 105-BIS: Nessun fallback cieco a 'TRECCIA' se l'anagrafica materiale manca
        const rawType = mat?.type?.toUpperCase()?.trim();
        const type = rawType
          ? rawType
          : compUpper.startsWith('GU')
            ? 'GUAINA'
            : compUpper.startsWith('TU')
              ? 'TUBI'
              : item.lunghezzaTaglioMm && Number(item.lunghezzaTaglioMm) > 0
                ? 'TRECCIA'
                : 'ALTRO';
        const isExternalized = Boolean(
          contoLavoroMap?.[job.id]?.includes(compUpper) || contoLavoroSet.has(compUpper)
        );

        // FALLBACK LOGIC O(1): Se la riga commessa non ha nota, recupera in O(1) dalla mappa BOM articolo
        let finalNote = (item.note || '').trim();
        if (!finalNote) {
          const cutKey = item.lunghezzaTaglioMm || 0;
          finalNote = articleBomNotesByKey.get(`${compUpper}__${cutKey}`) || '';
        }

        const enrichedBase = { ...item, note: finalNote, type, mat, isExternalized };
        const configMat = (mat?.type
          ? rawMaterialTypesMap.get(mat.type) || findMaterialTypeConfig(mat.type, globalSettings)
          : null) || {
          defaultUnit: mat?.unitOfMeasure || item.unit || 'n',
        };
        const req = calculateBOMRequirement(job.qta, enrichedBase, mat as any, configMat as any);

        return { ...enrichedBase, configMat, req };
      }),
    [
      sourceBom,
      materialsByCode,
      materialsMap,
      contoLavoroMap,
      job.id,
      job.qta,
      contoLavoroSet,
      articleBomNotesByKey,
      rawMaterialTypesMap,
    ]
  );

  const qrValue = React.useMemo(
    () =>
      (qrRule || "{ordinePF}@{details}@{qta}")
        .replace('{ordinePF}', job.ordinePF || '')
        .replace('{details}', job.details || '')
        .replace('{qta}', String(job.qta || ''))
        .replace('{numeroODLInterno}', job.numeroODLInterno || ''),
    [qrRule, job.ordinePF, job.details, job.qta, job.numeroODLInterno]
  );

  const {
    trecciaItems,
    tubiItems,
    guainaItems,
    hasTrecciaNotes,
    hasTubiNotes,
    hasGuainaNotes,
  } = React.useMemo(() => {
    const treccia: typeof allItems = [];
    const tubi: typeof allItems = [];
    const guaina: typeof allItems = [];
    let trecciaNotes = false;
    let tubiNotes = false;
    let guainaNotes = false;

    for (const item of allItems) {
      const section = resolveMaterialOdlSection(
        item.configMat as any,
        item.type,
        Boolean(item.lunghezzaTaglioMm && Number(item.lunghezzaTaglioMm) > 0)
      );
      if (section === 'TRECCIA') {
        treccia.push(item);
        if (!trecciaNotes && item.note && item.note.trim() !== '') trecciaNotes = true;
      } else if (section === 'TUBI') {
        tubi.push(item);
        if (!tubiNotes && item.note && item.note.trim() !== '') tubiNotes = true;
      } else if (section === 'GUAINA') {
        guaina.push(item);
        if (!guainaNotes && item.note && item.note.trim() !== '') guainaNotes = true;
      }
    }

    return {
      trecciaItems: treccia,
      tubiItems: tubi,
      guainaItems: guaina,
      hasTrecciaNotes: trecciaNotes,
      hasTubiNotes: tubiNotes,
      hasGuainaNotes: guainaNotes,
    };
  }, [allItems]);

  const getEstimatedTimeForSection = (phaseId: string) => {
    const timeData = resolvedArticle?.phaseTimes?.[phaseId];
    if (!timeData || (!timeData.expectedMinutesPerPiece && !timeData.detectedMinutesPerPiece)) return 'N/D';
    const mins = timeData.expectedMinutesPerPiece || timeData.detectedMinutesPerPiece || 0;
    const totalMins = Math.round(mins * job.qta);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const styles = React.useMemo(
    () => ({
      page: PAGE_STATIC_STYLE,
      masterTable: {
        width: '100%',
        borderCollapse: 'collapse' as const,
        tableLayout: 'fixed' as const,
        border: `1.5px solid ${config.colors.border}`,
      },
      cell: {
        border: `1px solid ${config.colors.border}`,
        padding: '0',
        fontSize: `${config.typography.baseFontSize}pt`,
        minHeight: '8.5mm',
        verticalAlign: (config.layout.verticalAlign || 'middle') as any,
        textAlign: (config.layout.textAlign || 'center') as any,
        lineHeight: '1.2',
        position: 'relative' as const,
      },
      label: {
        fontSize: `${config.typography.headerFontSize}pt`,
        fontWeight: 'bold' as const,
        color: config.colors.headerText || '#555',
        textAlign: 'center' as const,
      },
      title: {
        backgroundColor: config.colors.primary,
        color: 'white',
        fontWeight: 'bold' as const,
        fontSize: `${config.typography.titleFontSize}pt`,
        textAlign: 'center' as const,
        height: config.header.titleHeight || '12mm',
        position: 'relative' as const,
      },
      qrWrapper: QR_WRAPPER_STYLE,
      verificaGrid: VERIFICA_GRID_STYLE,
      verificaSlot: {
        flex: 1,
        borderRight: `1px solid ${config.colors.border}`,
      },
      valueLarge: VALUE_LARGE_STYLE,
      pageNumber: PAGE_NUMBER_STYLE,
    }),
    [config]
  );

  const cellFlexCache = React.useMemo(() => {
    const cache = new Map<string, React.CSSProperties>();
    const defaultV = config.layout.verticalAlign || 'middle';
    const defaultH = config.layout.textAlign || 'center';
    const paddingStr = `${config.layout.cellPadding || 0}px`;

    return {
      get: (colConfig?: any): React.CSSProperties => {
        const vAlign = colConfig?.verticalAlign || defaultV;
        const hAlign = colConfig?.textAlign || defaultH;
        const key = `${vAlign}__${hAlign}`;
        let cached = cache.get(key);
        if (!cached) {
          cached = {
            display: 'flex',
            alignItems: vAlign === 'top' ? 'flex-start' : vAlign === 'bottom' ? 'flex-end' : 'center',
            justifyContent: hAlign === 'left' ? 'flex-start' : hAlign === 'right' ? 'flex-end' : 'center',
            height: '100%',
            width: '100%',
            whiteSpace: 'normal' as any,
            wordBreak: 'break-word' as any,
            padding: paddingStr,
            boxSizing: 'border-box' as const,
          };
          cache.set(key, cached);
        }
        return cached;
      },
    };
  }, [config.layout.verticalAlign, config.layout.textAlign, config.layout.cellPadding]);

  const getCellFlexStyles = (colConfig?: any) => cellFlexCache.get(colConfig);

  const activeHeaderCols = config.header.columns?.filter(c => c.visible) || [];

  const renderHeader = (isContinuation: boolean = false, isMeasureProbe: boolean = false) => {
    const logoSrc = config.header.logoBase64 || config.header.logoUrl;
    
    // Minimalist header for continuation pages
    if (isContinuation) {
        return (
            <div style={{ marginBottom: '2mm', flexShrink: 0 }}>
                <table style={{ ...styles.masterTable }}>
                    <colgroup>
                        <col width="15%" />
                        <col width="50%" />
                        <col width="35%" />
                    </colgroup>
                    <tbody>
                        <tr>
                            <td style={{ ...styles.cell, borderBottom: 0, padding: '1mm' }}>
                                {logoSrc && (isMeasureProbe
                                  ? <div style={{ height: '8mm', width: '10mm' }} />
                                  : <img src={logoSrc} alt="Logo" decoding="async" loading="eager" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ height: '8mm', objectFit: 'contain' }} />
                                )}
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
      <div style={{ marginBottom: '2mm', position: 'relative', flexShrink: 0 }}>
        {config.header.showRevInfo && config.header.revText && (
          <div
            style={{
              width: '100%',
              textAlign: 'right',
              fontSize: '7pt',
              lineHeight: '1.15',
              color: '#333',
              fontWeight: 'bold',
              marginBottom: '0.8mm',
            }}
          >
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
                                            {logoSrc && (isMeasureProbe
                                              ? <div style={{ height: `${config.header.logoHeight}px`, width: '20mm' }} />
                                              : <img src={logoSrc} alt="Logo" decoding="async" loading="eager" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ height: `${config.header.logoHeight}px`, maxWidth: '95%', objectFit: 'contain' }} />
                                            )}
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
                                if (col.field === 'reparto') {
                                    const deptCode = (job.department ? departmentCodeMap.get(job.department) : undefined) || job.department;
                                    val = deptCode || 'N/D';
                                }
                                if (col.field === 'dataOdl') val = format(printDate || new Date(), 'dd/MM/yyyy');
                                if (col.field === 'ordinePf') val = job.ordinePF;
                                if (col.field === 'numeroOdl') val = job.numeroODLInterno || '---';

                                return (
                                  <td key={col.id} style={{ 
                                    ...styles.cell, 
                                    borderLeft: idx === 0 ? 0 : `1px solid ${config.colors.border}`, 
                                    borderRight: idx === activeHeaderCols.length - 1 ? 0 : `1px solid ${config.colors.border}`, 
                                    borderBottom: 0, 
                                    fontSize: `${col.fontSize || 11}pt`, 
                                    backgroundColor: col.isAuxiliary ? 'white' : (col.field === 'reparto' || col.field === 'ordinePf' || col.field === 'numeroOdl' ? config.colors.bgValueGreen : 'white') 
                                  }}>
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
                                {isMeasureProbe
                                  ? <div style={{ width: `${config.header.qrSize || 65}px`, height: `${config.header.qrSize || 65}px` }} />
                                  : <MemoizedQRCode value={qrValue} size={config.header.qrSize || 65} />
                                }
                            </div>
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
      </div>
    );
  };

  const renderJobDetails = (showDrawingArea: boolean = true, isMeasureProbe: boolean = false) => {
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

    const technicalNotes = (resolvedArticle?.technicalNotes || job.technicalNotes || '').trim();
    const technicalDrawingUrl = (resolvedArticle?.technicalDrawingUrl || job.technicalDrawingUrl || '').trim();
    const hasNotes = technicalNotes.length > 0;
    const hasDrawing = technicalDrawingUrl.length > 0;

    const renderDrawingArea = () => (
      <td
        style={{
          ...styles.cell,
          color: hasNotes || hasDrawing ? '#111111' : config.colors.drawingAreaText,
          fontWeight: 'bold',
          fontSize: '18pt',
          backgroundColor: config.colors.drawingAreaBg,
          textAlign: 'center',
          verticalAlign: 'middle',
          borderLeft: `1.5px solid ${config.colors.border}`,
          height: config.layout.drawingAreaHeight || '40mm',
          maxHeight: config.layout.drawingAreaHeight || '40mm',
          overflow: 'hidden',
        }}
        rowSpan={rowCount}
      >
        {hasNotes && hasDrawing ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'flex-start',
              width: '100%',
              height: config.layout.drawingAreaHeight || '40mm',
              padding: '2mm',
              boxSizing: 'border-box',
              gap: '1.5mm',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: '100%',
                fontSize: '9pt',
                fontWeight: 'bold',
                color: '#111111',
                textAlign: 'left',
                whiteSpace: 'pre-wrap',
                lineHeight: '1.25',
                flex: '0 0 auto',
                maxHeight: '42%',
                overflow: 'hidden',
              }}
            >
              {technicalNotes}
            </div>
            <div
              style={{
                flex: '1 1 auto',
                width: '100%',
                minHeight: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {isMeasureProbe ? (
                <div style={{ width: '100%', height: '100%' }} />
              ) : (
                <img
                  src={technicalDrawingUrl}
                  alt="Disegno Tecnico"
                  crossOrigin="anonymous"
                  decoding="async"
                  loading="eager"
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (img.getAttribute('crossorigin')) {
                      img.removeAttribute('crossorigin');
                      img.src = technicalDrawingUrl;
                    } else {
                      img.style.display = 'none';
                    }
                  }}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              )}
            </div>
          </div>
        ) : hasNotes ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              justifyContent: 'flex-start',
              width: '100%',
              height: config.layout.drawingAreaHeight || '40mm',
              padding: '2.5mm',
              boxSizing: 'border-box',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: '100%',
                fontSize: '10pt',
                fontWeight: 'bold',
                color: '#111111',
                textAlign: 'left',
                whiteSpace: 'pre-wrap',
                lineHeight: '1.3',
              }}
            >
              {technicalNotes}
            </div>
          </div>
        ) : hasDrawing ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: config.layout.drawingAreaHeight || '40mm',
              padding: '1.5mm',
              boxSizing: 'border-box',
              overflow: 'hidden',
            }}
          >
            {isMeasureProbe ? (
              <div style={{ width: '100%', height: '100%' }} />
            ) : (
              <img
                src={technicalDrawingUrl}
                alt="Disegno Tecnico"
                crossOrigin="anonymous"
                decoding="async"
                loading="eager"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.getAttribute('crossorigin')) {
                    img.removeAttribute('crossorigin');
                    img.src = technicalDrawingUrl;
                  } else {
                    img.style.display = 'none';
                  }
                }}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            )}
          </div>
        ) : (
          <div style={{ ...getCellFlexStyles(), flexDirection: 'column', gap: '2mm' }}>
            <div>{config.layout.showDrawingArea ? config.layout.drawingAreaText : ''}</div>
          </div>
        )}
      </td>
    );

    return (
      <div style={{ marginBottom: '2mm', flexShrink: 0 }}>
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
                <td style={{ ...styles.cell, backgroundColor: row.isAuxiliary ? 'white' : resolveColBg(row.colorKey), fontWeight: 'bold', fontSize: `${config.info.fontSize + 2}pt` }}>
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
            const compUpper = (item.component || '').toUpperCase().trim();
            const req = item.req;
            
            // FASE 47 & FASE 88: Verifica materiale esternalizzato in Conto Lavoro tramite lookup O(1) sul dizionario in memoria
            const isExternalized = Boolean(
              item.isExternalized ??
              (contoLavoroMap?.[job.id]?.includes(compUpper) || contoLavoroSet.has(compUpper))
            );

            const data: any = {
              codice: item.component,
              lunghezzaTaglio: item.lunghezzaTaglioMm || 0,
              quantita: req.totalPieces,
              // FASE 104-BIS: In Stampa ODL esponiamo esclusivamente valori NETTI (zero scarto %)
              pesoTotale: (req.netWeightKg ?? req.weightKg).toFixed(1),
              metriTotali: (req.netMeters ?? req.totalMeters)?.toFixed(2) || '0.00',
              placeholder: '',
              checkbox: isExternalized ? '☑ ESTERNO' : '□',
              tempoPrevisto: '',
              note: item.note || ''
            };

            const rowBg = isExternalized 
              ? '#e5e7eb' // Grigio chiaro per riga esternalizzata (bg-gray-200)
              : (sectionType === 'treccia' ? config.colors.bgTreccia : sectionType === 'tubi' ? config.colors.bgTubi : config.colors.bgGuaina);

            return (
              <tr 
                key={`${sectionType}-${i}`} 
                style={{ 
                  minHeight: '9.2mm', 
                  backgroundColor: rowBg,
                  color: isExternalized ? '#374151' : undefined
                }}
              >
                {visibleCols.map((col) => {
                  const isTempoPrevisto = col.field === 'tempoPrevisto';
                  const cellFontSize = col.fontSize || config.typography.baseFontSize;
                  if (isTempoPrevisto) {
                    if (i === 0) {
                      return (
                        <td key={col.id} rowSpan={items.length} style={{ ...styles.cell, fontWeight: 'bold', fontSize: `${cellFontSize}pt`, backgroundColor: isExternalized ? '#e5e7eb' : 'white' }}>
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
                  const cellBg = col.isAuxiliary 
                    ? (isExternalized ? '#e5e7eb' : 'white') 
                    : (isExternalized ? '#e5e7eb' : undefined);

                  return (
                    <td key={col.id} style={{ ...styles.cell, fontSize: `${cellFontSize}pt`, backgroundColor: cellBg }}>
                      <div style={getCellFlexStyles(col)}>
                        {col.field === 'placeholder' ? (
                          isExternalized ? (
                            <span style={{ color: '#b91c1c', fontSize: '6.5pt', fontWeight: 'bold', fontStyle: 'italic', letterSpacing: '0.3px' }}>
                              ESTERNO
                            </span>
                          ) : (
                            <div style={styles.verificaGrid}><div style={styles.verificaSlot}></div><div style={styles.verificaSlot}></div><div style={{ flex: 1 }}></div></div>
                          )
                        ) : col.field === 'codice' && isExternalized ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap' }}>
                            <span style={{ textDecoration: 'line-through', opacity: 0.75, fontWeight: 'bold' }}>
                              {item.component}
                            </span>
                            <span style={{
                              backgroundColor: '#dc2626',
                              color: 'white',
                              fontSize: '6pt',
                              fontWeight: '900',
                              padding: '1px 3.5px',
                              borderRadius: '2px',
                              letterSpacing: '0.4px',
                              lineHeight: '1.1'
                            }}>
                              ESTERNO
                            </span>
                          </div>
                        ) : col.field === 'checkbox' && isExternalized ? (
                          <span style={{ color: '#b91c1c', fontWeight: '900', fontSize: '7.5pt', letterSpacing: '0.4px' }}>
                            ☑ ESTERNO
                          </span>
                        ) : (
                          displayValue
                        )}
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
    <table style={{ ...styles.masterTable, marginTop: '1.5mm', flexShrink: 0 }}>
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
          <td style={{ ...styles.cell, padding: '1.5mm 3mm' }} colSpan={4}>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'flex-end', height: '100%', paddingBottom: '1mm', fontSize: '7.5pt' }}>
                <span style={{ fontWeight: 'bold' }}>DATA: ___/___/______</span>
                <span style={{ fontWeight: 'bold' }}>FIRMA: ___________________________________</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );

  // --- PAGINATION LOGIC V3: Misurazione Reale DOM a 2 Passaggi (Designer-Proof) ---
  const activeSectionsData = React.useMemo(() => {
    const defs: Array<{
      sectionType: OdlSectionType;
      categoryName: string;
      items: typeof allItems;
      colConfig: any[];
      hasNotes: boolean;
    }> = [];
    if (trecciaItems.length > 0) {
      defs.push({
        sectionType: 'treccia',
        categoryName: 'Componenti Treccia/Corda',
        items: trecciaItems,
        colConfig: config.columns.treccia,
        hasNotes: hasTrecciaNotes,
      });
    }
    if (tubiItems.length > 0) {
      defs.push({
        sectionType: 'tubi',
        categoryName: 'Componenti Tubi',
        items: tubiItems,
        colConfig: config.columns.tubi,
        hasNotes: hasTubiNotes,
      });
    }
    if (guainaItems.length > 0) {
      defs.push({
        sectionType: 'guaina',
        categoryName: 'Componenti Guaina',
        items: guainaItems,
        colConfig: config.columns.guaina,
        hasNotes: hasGuainaNotes,
      });
    }
    return defs;
  }, [
    trecciaItems,
    tubiItems,
    guainaItems,
    hasTrecciaNotes,
    hasTubiNotes,
    hasGuainaNotes,
    config.columns.treccia,
    config.columns.tubi,
    config.columns.guaina,
  ]);

  const sectionsByType = React.useMemo(() => {
    const map: Partial<Record<OdlSectionType, (typeof activeSectionsData)[number]>> = {};
    for (const sec of activeSectionsData) {
      map[sec.sectionType] = sec;
    }
    return map;
  }, [activeSectionsData]);

  const initialPages = React.useMemo(
    () => paginateOdlSectionsByHeight(estimateInitialOdlPaginationInput(config, activeSectionsData)),
    [config, activeSectionsData]
  );

  const [measuredPlan, setMeasuredPlan] = React.useState<{ key: string; pages: OdlPaginatedPage[] } | null>(null);
  const [isMeasureReady, setIsMeasureReady] = React.useState<boolean>(false);
  const lastPlanKeyRef = React.useRef<string>('');
  const measureRootRef = React.useRef<HTMLDivElement | null>(null);
  const rulerRef = React.useRef<HTMLDivElement | null>(null);
  const headerFirstMeasureRef = React.useRef<HTMLDivElement | null>(null);
  const headerContMeasureRef = React.useRef<HTMLDivElement | null>(null);
  const jobDetailsMeasureRef = React.useRef<HTMLDivElement | null>(null);
  const footerMeasureRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    const rootEl = measureRootRef.current;
    if (!rootEl) {
      setIsMeasureReady(true);
      return;
    }

    const rulerHeight = rulerRef.current?.getBoundingClientRect().height || 0;
    const pxPerMm = rulerHeight > 0 ? rulerHeight / USABLE_PAGE_HEIGHT_MM : 96 / 25.4;
    const toMm = (el: Element | null | undefined, fallbackMm: number): number => {
      if (!el) return fallbackMm;
      const h = el.getBoundingClientRect().height;
      return h > 0 ? h / pxPerMm : fallbackMm;
    };

    const hHeader1 = toMm(headerFirstMeasureRef.current, 32);
    const hHeaderCont = toMm(headerContMeasureRef.current, 13.5);
    const hDetails = toMm(jobDetailsMeasureRef.current, 45);
    const hFooter = toMm(footerMeasureRef.current, 23);

    const measuredSections = activeSectionsData.map((sec) => {
      const secWrap = rootEl.querySelector(`[data-measure-sec="${sec.sectionType}"]`);
      const secHeaderEl = secWrap?.querySelector(`[data-measure-sec-header="${sec.sectionType}"]`);
      const theadEl = secWrap?.querySelector('thead');
      const rowEls = secWrap ? Array.from(secWrap.querySelectorAll('tbody > tr')) : [];

      const sectionHeaderMm = toMm(secHeaderEl, 6.8);
      // +1.0mm per bordi masterTable di tabella separata
      const tableHeaderMm = toMm(theadEl, 7.5) + 1.0;
      const rowHeightsMm = rowEls.map((tr) => toMm(tr, 9.2));

      return {
        sectionType: sec.sectionType,
        categoryName: sec.categoryName,
        sectionHeaderMm,
        tableHeaderMm,
        rowHeightsMm,
      };
    });

    const nextPages = paginateOdlSectionsByHeight({
      usablePageHeightMm: USABLE_PAGE_HEIGHT_MM,
      safetyMarginMm: 1.5,
      page1HeaderPlusDetailsMm: hHeader1 + hDetails,
      subsequentHeaderMm: hHeaderCont,
      footerMm: hFooter,
      sections: measuredSections,
      splitByCategoryThreshold: config.layout.splitByCategoryThreshold,
    });

    const nextKey = JSON.stringify(nextPages);
    if (lastPlanKeyRef.current !== nextKey) {
      lastPlanKeyRef.current = nextKey;
      setMeasuredPlan({ key: nextKey, pages: nextPages });
    }
    setIsMeasureReady(true);
  }, [
    activeSectionsData,
    config,
    departmentCodeMap,
    job.cliente,
    job.department,
    job.details,
    job.dataConsegnaFinale,
    job.dataFinePreparazione,
    job.numeroODLInterno,
    job.ordinePF,
    job.qta,
    job.technicalDrawingUrl,
    job.technicalNotes,
    resolvedArticle?.technicalDrawingUrl,
    resolvedArticle?.technicalNotes,
    resolvedArticle?.phaseTimes,
  ]);

  const pages = measuredPlan?.pages ?? initialPages;

  return (
    <div
      id={omitRootId ? undefined : "odl-pdf-pages"}
      data-odl-template-root="true"
      data-odl-ready={isMeasureReady ? "true" : "false"}
      style={ODL_ROOT_WRAPPER_STYLE}
    >
      {/* Sonda off-screen a larghezza utile reale 284mm (= 297mm - 2 * 6.5mm) per misurare ingombri DOM reali */}
      <div
        ref={measureRootRef}
        data-odl-measure="true"
        aria-hidden="true"
        style={MEASURE_ROOT_STYLE}
      >
        <div ref={rulerRef} style={MEASURE_RULER_STYLE} />
        <div ref={headerFirstMeasureRef} style={MEASURE_FLOW_ROOT_STYLE}>
          {renderHeader(false, true)}
        </div>
        <div ref={headerContMeasureRef} style={MEASURE_FLOW_ROOT_STYLE}>
          {renderHeader(true, true)}
        </div>
        <div ref={jobDetailsMeasureRef} style={MEASURE_FLOW_ROOT_STYLE}>
          {renderJobDetails(true, true)}
        </div>
        <div ref={footerMeasureRef} style={MEASURE_FLOW_ROOT_STYLE}>
          {renderFooter()}
        </div>
        {activeSectionsData.map((sec) => (
          <div key={`m-${sec.sectionType}`} data-measure-sec={sec.sectionType}>
            <div data-measure-sec-header={sec.sectionType} style={MEASURE_FLOW_ROOT_STYLE}>
              {renderSectionHeader(sec.categoryName, false)}
            </div>
            {renderTableRows(sec.items, sec.colConfig, sec.sectionType, sec.hasNotes)}
          </div>
        ))}
      </div>

      {pages.map((page, idx) => {
        const isFirstPageOfDoc = idx === 0;
        const isLastPageOfDoc = idx === pages.length - 1;

        return (
          <div key={idx} className="odl-page" style={styles.page}>
             {renderHeader(!isFirstPageOfDoc)}
             {isFirstPageOfDoc && renderJobDetails(true)}
             
             <div style={{ flex: 1 }}>
                {page.chunks.map((chunk, cIdx) => {
                    const sec = sectionsByType[chunk.sectionType];
                    const chunkItems =
                      sec && chunk.rowIndices.length > 0
                        ? chunk.rowIndices.map((rowIdx) => sec.items[rowIdx]).filter(Boolean)
                        : [];

                    return (
                      <React.Fragment key={`${chunk.sectionType}-${chunk.isContinuation ? 'cont' : 'main'}-${cIdx}`}>
                        {renderSectionHeader(chunk.categoryName, chunk.isContinuation)}
                        {sec && chunkItems.length > 0 && renderTableRows(chunkItems, sec.colConfig, chunk.sectionType, sec.hasNotes)}
                      </React.Fragment>
                    );
                })}
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

export default React.memo(ODLPrintTemplate);
