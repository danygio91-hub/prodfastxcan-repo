import React from 'react';
import { getCompletedJobs } from './actions';
import PackingClientPage from './PackingClientPage';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';

export const metadata = {
    title: 'Packing List & Spedizioni | MES',
    description: 'Gestione spedizioni e generazione packing list.',
};

export default async function PackingPage() {
    const completedJobs = await getCompletedJobs();
    
    // Convertiamo eventuali date/timestamp per evitare errori di serializzazione se necessario
    const serializedJobs = JSON.parse(JSON.stringify(completedJobs));

    return (
        <AuthGuard>
            <AppShell>
                <PackingClientPage initialJobs={serializedJobs} />
            </AppShell>
        </AuthGuard>
    );
}
