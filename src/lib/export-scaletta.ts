import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { JobOrder } from '@/types';

export function exportScaletta(jobs: { job: JobOrder }[], deptId: string, weekLabel: string) {
    if (!jobs || jobs.length === 0) {
        alert("Nessuna commessa da esportare per questo reparto.");
        return;
    }

    const data = jobs.map((pj, index) => {
        const job = pj.job;
        const seq = job.dailySequence || 0;
        
        return {
            'Num': index + 1,
            'Daily Sequence': seq,
            'Stato': job.status,
            'Data': job.dataConsegnaFinale && job.dataConsegnaFinale !== 'N/D' ? job.dataConsegnaFinale : 'N/D',
            'Cliente': job.cliente || '',
            'Articolo (PF)': job.ordinePF || '',
            'Descrizione': job.details || '',
            'ODL': job.numeroODLInterno || '',
            'Q.tà (Pz)': job.qta || 0
        };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    
    // Auto-size columns
    const wscols = [
        { wch: 5 },  // Num
        { wch: 15 }, // Seq
        { wch: 20 }, // Stato
        { wch: 15 }, // Data
        { wch: 25 }, // Cliente
        { wch: 20 }, // PF
        { wch: 40 }, // Desc
        { wch: 15 }, // ODL
        { wch: 10 }  // Pz
    ];
    worksheet['!cols'] = wscols;

    XLSX.utils.book_append_sheet(workbook, worksheet, "Scaletta");

    const fileName = `Scaletta_Reparto_${deptId}_${weekLabel}_${format(new Date(), 'yyyyMMdd')}.xlsx`;
    
    XLSX.writeFile(workbook, fileName);
}
