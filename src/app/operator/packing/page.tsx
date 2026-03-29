import React from 'react';
import { getCompletedJobs } from './actions';
import PackingClientPage from './PackingClientPage';

export const metadata = {
    title: 'Packing List & Spedizioni | MES',
    description: 'Gestione spedizioni e generazione packing list.',
};

export default async function PackingPage() {
    const completedJobs = await getCompletedJobs();
    
    // Convertiamo eventuali date/timestamp per evitare errori di serializzazione se necessario
    const serializedJobs = JSON.parse(JSON.stringify(completedJobs));

    return (
        <main className="min-h-screen bg-slate-50/50">
            <PackingClientPage initialJobs={serializedJobs} />
        </main>
    );
}
