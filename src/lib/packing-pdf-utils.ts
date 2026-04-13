import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { PackingList } from '@/types';

// Extend jsPDF with autotable types
declare module 'jspdf' {
    interface jsPDF {
        autoTable: (options: any) => jsPDF;
    }
}

/**
 * Genera un PDF professionale per la Packing List
 */
export const generatePackingListPDF = (pl: PackingList) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // --- Header ---
    doc.setFontSize(22);
    doc.setTextColor(40, 44, 52);
    doc.text('PACKING LIST', 14, 22);
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`ID Documento: ${pl.id}`, 14, 30);
    doc.text(`Data: ${pl.createdAt ? new Date(pl.createdAt.seconds * 1000).toLocaleDateString('it-IT') : new Date().toLocaleDateString('it-IT')}`, 14, 35);
    
    doc.setDrawColor(200);
    doc.line(14, 40, pageWidth - 14, 40);

    // --- Azienda & Operatore ---
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.text('EMITTENTE:', 14, 50);
    doc.setFont('helvetica', 'normal');
    doc.text('ProdFast Xcan - Power Flex S.r.l.', 14, 55);
    doc.text('Divisione Logistica & Spedizioni', 14, 60);

    doc.setFont('helvetica', 'bold');
    doc.text('OPERATORE:', pageWidth - 80, 50);
    doc.setFont('helvetica', 'normal');
    const operatorStr = `${pl.operatorName} (ID: ${pl.operatorId})`;
    doc.text(operatorStr, pageWidth - 80, 55);

    // --- Tabella Articoli ---
    const tableData = pl.items.map(item => [
        item.client,
        item.orderPF,
        item.articleCode,
        item.quantity.toLocaleString('it-IT'),
        item.weight ? item.weight.toFixed(2) : '-',
        item.packages ? item.packages.toString() : '1',
    ]);

    const totalWeight = pl.items.reduce((acc, i) => acc + (i.weight || 0), 0);
    const totalPackages = pl.items.reduce((acc, i) => acc + (i.packages || 0), 0);

    doc.autoTable({
        startY: 75,
        head: [['CLIENTE', 'ORDINE', 'ARTICOLO', 'Q.TÀ', 'PESO (KG)', 'COLLI']],
        body: tableData,
        foot: [['', '', 'TOTALI', '', totalWeight.toFixed(2), totalPackages.toString()]],
        theme: 'striped',
        headStyles: { 
            fillColor: [41, 128, 185], 
            textColor: 255,
            fontSize: 9,
            fontStyle: 'bold'
        },
        footStyles: {
            fillColor: [230, 230, 230],
            textColor: 0,
            fontStyle: 'bold',
            fontSize: 9
        },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        styles: { fontSize: 8, cellPadding: 3 },
        margin: { top: 75 },
    });

    // --- Footer ---
    const finalY = (doc as any).lastAutoTable.finalY + 20;
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Documento generato digitalmente dal sistema MES ProdFastXcan.', 14, finalY);
    doc.text('Il presente documento attesta la chiusura della fase di imballaggio e la prontezza per il ritiro.', 14, finalY + 5);

    // --- Firma ---
    doc.setDrawColor(150);
    doc.line(pageWidth - 70, finalY + 15, pageWidth - 14, finalY + 15);
    doc.text('Firma Responsabile Logistica', pageWidth - 65, finalY + 20);

    // Save
    doc.save(`PackingList_${pl.id}.pdf`);
};
