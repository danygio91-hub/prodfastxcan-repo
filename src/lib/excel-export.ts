import ExcelJS from 'exceljs';
import { format, parseISO } from 'date-fns';

export interface ExportJobData {
    id: string;
    cliente: string;
    ordinePF: string;
    details: string; // Codice Articolo
    qta: number;
    dataFinePreparazione?: string;
    dataConsegnaFinale?: string;
    numeroODLInterno?: string;
    department?: string;
}

export function buildPlanningWorkbook(
    jobs: ExportJobData[],
    macroArea: 'PREP' | 'CORE' | 'PACK' | string,
    weekTitle: string,
    deptName: string = 'PRODUZIONE'
): ExcelJS.Workbook {
    // 1. Preparazione Dati e Sorting
    const sortedJobs = [...jobs].sort((a, b) => {
        const dateA = macroArea === 'PREP' ? (a.dataFinePreparazione || a.dataConsegnaFinale) : a.dataConsegnaFinale;
        const dateB = macroArea === 'PREP' ? (b.dataFinePreparazione || b.dataConsegnaFinale) : b.dataConsegnaFinale;

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        if (dateA !== dateB) {
            return dateA.localeCompare(dateB);
        }

        if (a.cliente !== b.cliente) {
            return (a.cliente || '').localeCompare(b.cliente || '');
        }

        return (a.details || '').localeCompare(b.details || '');
    });

    // 2. Inizializzazione ExcelJS
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('REPORT PLANNING');

    // 3. Definizione Colonne (Ottimizzate per A4 Orizzontale)
    const columns = [
        { header: 'CLIENTE', key: 'cliente', width: 30 },
        { header: 'ORDINE PF', key: 'ordinePF', width: 25 },
        { header: 'CODICE ARTICOLO', key: 'details', width: 35 },
        { header: 'QUANTITA\'', key: 'qta', width: 12 },
        { header: 'DATA CONSEGNA', key: 'data', width: 20 },
        { header: 'N° ODL', key: 'odl', width: 15 },
    ];
    worksheet.columns = columns;

    // Impostazioni di Stampa: A4 Orizzontale
    worksheet.pageSetup = {
        orientation: 'landscape',
        paperSize: 9, // A4
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0, // Auto
        margins: {
            left: 0.5, right: 0.5,
            top: 0.5, bottom: 0.5,
            header: 0.3, footer: 0.3
        }
    };

    // Blocca le prime 2 righe (Intestazione Settimana + Titoli)
    worksheet.views = [
        { state: 'frozen', ySplit: 2 }
    ];

    // 4. AGGIUNTA INTESTAZIONE SETTIMANA (MERGED CELL) E CONTATORE
    const isMultiWeek = weekTitle.toLowerCase().includes('settimane') || weekTitle.includes('-');
    const weekHeaderPrefix = isMultiWeek ? 'SETTIMANE' : 'SETTIMANA';
    const cleanWeekNum = weekTitle.replace(/settimana[e]?\s*/i, '').trim() || weekTitle;

    worksheet.insertRow(1, { cliente: `PIANO DI PRODUZIONE - ${deptName.toUpperCase()} - ${weekHeaderPrefix} ${cleanWeekNum}` });
    worksheet.mergeCells('A1:D1');
    worksheet.mergeCells('E1:F1');
    
    const weekHeaderCell = worksheet.getCell('A1');
    weekHeaderCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF000000' } };
    weekHeaderCell.alignment = { horizontal: 'center', vertical: 'middle' };
    weekHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    weekHeaderCell.border = {
        top: { style: 'thick', color: { argb: 'FF000000' } },
        left: { style: 'thick', color: { argb: 'FF000000' } },
        bottom: { style: 'thick', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
    };

    const counterCell = worksheet.getCell('E1');
    counterCell.value = `Totale Commesse: ${sortedJobs.length}`;
    counterCell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF000000' } };
    counterCell.alignment = { horizontal: 'center', vertical: 'middle' };
    counterCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    counterCell.border = {
        top: { style: 'thick', color: { argb: 'FF000000' } },
        right: { style: 'thick', color: { argb: 'FF000000' } },
        bottom: { style: 'thick', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FFCCCCCC' } }
    };
    worksheet.getRow(1).height = 35;

    // 5. Mappaggio Colore Macroarea e Reparto
    let headerBgColor = 'FF6366F1'; // Indaco default
    const upperDept = deptName.toUpperCase();
    const upperArea = String(macroArea || '').toUpperCase();
    
    if (upperDept.includes('PREPARAZIONE') || upperDept.includes('PREP') || upperArea === 'PREP') {
        headerBgColor = 'FFF59E0B'; // Arancione/Ocra (#F59E0B)
    } else if (upperDept.includes('REPARTO BARRE') || upperDept.includes('BARRE') || upperDept.includes('BF') || upperArea === 'BF') {
        headerBgColor = 'FF0EA5E9'; // Azzurro/Ciano (#0EA5E9)
    } else if (upperDept.includes('CONNESSIONI GRANDI') || upperDept.includes('GRANDI') || upperDept.includes('CG') || upperArea === 'CG') {
        headerBgColor = 'FF10B981'; // Verde Smeraldo (#10B981)
    } else if (upperDept.includes('CONNESSIONI PICCOLE') || upperDept.includes('PICCOLE') || upperDept.includes('CP') || upperArea === 'CP') {
        headerBgColor = 'FFEA580C'; // Arancione Scuro (#EA580C)
    } else if (upperDept.includes('PACK') || upperDept.includes('QUALITÀ') || upperDept.includes('QUALITA') || upperArea === 'PACK') {
        headerBgColor = 'FF64748B'; // Grigio Scuro / Slate (#64748B)
    }

    // 6. Stile Intestazione Colonne (Riga 2 ora)
    const headerRow = worksheet.getRow(2);
    headerRow.height = 30;
    headerRow.eachCell((cell, colNumber) => {
        cell.font = { 
            name: 'Arial', 
            size: 11, 
            bold: true, 
            color: { argb: 'FFFFFFFF' } // Bianco
        };
        cell.fill = { 
            type: 'pattern', 
            pattern: 'solid', 
            fgColor: { argb: headerBgColor } 
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        
        // Bordi Intestazione (Sottili interni, Spessi esterni)
        cell.border = {
            top: { style: 'thick', color: { argb: 'FF000000' } },
            left: { style: colNumber === 1 ? 'thick' : 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'medium', color: { argb: 'FF000000' } },
            right: { style: colNumber === columns.length ? 'thick' : 'thin', color: { argb: 'FF000000' } }
        };
    });

    // 7. Aggiunta Dati con Stile Tabella
    sortedJobs.forEach((job, index) => {
        const contextualDate = macroArea === 'PREP' 
            ? (job.dataFinePreparazione || job.dataConsegnaFinale) 
            : job.dataConsegnaFinale;
            
        let formattedDate = 'N/D';
        if (contextualDate) {
            try {
                const parsed = parseISO(contextualDate);
                if (!isNaN(parsed.getTime())) {
                    formattedDate = format(parsed, 'dd/MM/yyyy');
                } else {
                    const fallback = new Date(contextualDate);
                    if (!isNaN(fallback.getTime())) {
                        formattedDate = format(fallback, 'dd/MM/yyyy');
                    }
                }
            } catch {
                formattedDate = String(contextualDate);
            }
        }

        const row = worksheet.addRow({
            cliente: job.cliente?.toUpperCase() || '',
            ordinePF: job.ordinePF?.toUpperCase() || '',
            details: job.details?.toUpperCase() || '',
            qta: job.qta || 0,
            data: formattedDate,
            odl: job.numeroODLInterno || ''
        });

        row.height = 22;
        const isLastRow = index === sortedJobs.length - 1;

        row.eachCell((cell, colNumber) => {
            cell.font = { name: 'Arial', size: 10 };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            
            // Bordi celle (Sottili interni, Spessi esterni)
            cell.border = {
                top: { style: 'thin', color: { argb: 'FF999999' } },
                left: { style: colNumber === 1 ? 'thick' : 'thin', color: { argb: 'FF999999' } },
                bottom: { style: isLastRow ? 'thick' : 'thin', color: { argb: 'FF999999' } },
                right: { style: colNumber === columns.length ? 'thick' : 'thin', color: { argb: 'FF999999' } }
            };
        });
    });

    return workbook;
}

export async function generatePlanningExcelBuffer(
    jobs: ExportJobData[],
    macroArea: 'PREP' | 'CORE' | 'PACK' | string,
    weekTitle: string,
    deptName: string = 'PRODUZIONE'
): Promise<Buffer | ArrayBuffer> {
    const workbook = buildPlanningWorkbook(jobs, macroArea, weekTitle, deptName);
    return await workbook.xlsx.writeBuffer();
}

export async function exportPlanningToExcel(
    jobs: ExportJobData[],
    macroArea: 'PREP' | 'CORE' | 'PACK' | string,
    weekTitle: string,
    deptName: string = 'PRODUZIONE'
) {
    const buffer = await generatePlanningExcelBuffer(jobs, macroArea, weekTitle, deptName);
    if (typeof window !== 'undefined') {
        const blob = new Blob([buffer as any], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const fileName = `Report_Planning_${macroArea}_${weekTitle.replace(/\s+/g, '_')}.xlsx`;

        // Metodo di download universale per browser
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(anchor);
    }
}
