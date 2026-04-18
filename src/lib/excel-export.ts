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

export async function exportPlanningToExcel(
    jobs: ExportJobData[],
    macroArea: 'PREP' | 'CORE' | 'PACK',
    weekTitle: string
) {
    // 1. Preparazione Dati e Sorting (Stessa logica di prima)
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

    // 4. AGGIUNTA INTESTAZIONE SETTIMANA (MERGED CELL)
    const weekNum = weekTitle.match(/\d+/)?.[0] || 'XX';
    worksheet.insertRow(1, { cliente: `PIANO DI PRODUZIONE - SETTIMANA ${weekNum}` });
    worksheet.mergeCells('A1:F1');
    const weekHeaderCell = worksheet.getCell('A1');
    weekHeaderCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF000000' } };
    weekHeaderCell.alignment = { horizontal: 'center', vertical: 'middle' };
    weekHeaderCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF1F5F9' } // Light slate background
    };
    weekHeaderCell.border = {
        top: { style: 'thick', color: { argb: 'FF000000' } },
        left: { style: 'thick', color: { argb: 'FF000000' } },
        bottom: { style: 'thick', color: { argb: 'FF000000' } },
        right: { style: 'thick', color: { argb: 'FF000000' } }
    };
    worksheet.getRow(1).height = 35;

    // 5. Mappaggio Colore Macroarea
    const macroAreaColors: Record<string, string> = {
        'PREP': 'FFF59E0B', // Amber-500
        'CORE': 'FF2563EB', // Blue-600
        'PACK': 'FF10B981', // Emerald-500
    };
    const headerBgColor = macroAreaColors[macroArea] || 'FF6366F1';

    // 6. Stile Intestazione Colonne (Riga 2 ora)
    const headerRow = worksheet.getRow(2);
    headerRow.height = 30;
    headerRow.eachCell((cell, colNumber) => {
        cell.font = { 
            name: 'Arial',
            size: 11,
            bold: true, 
            italic: true, 
            color: { argb: 'FF000000' } // Nero
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
            
        const row = worksheet.addRow({
            cliente: job.cliente?.toUpperCase() || '',
            ordinePF: job.ordinePF?.toUpperCase() || '',
            details: job.details?.toUpperCase() || '',
            qta: job.qta || 0,
            data: contextualDate ? format(parseISO(contextualDate), 'dd/MM/yyyy') : 'N/D',
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

    // 7. Generazione Blob e Download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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
