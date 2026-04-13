import { getAvailableJobsForPacking } from './actions';
import PackingClientPage from './PackingClientPage';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';

export const metadata = {
    title: 'Packing List & Spedizioni | MES',
    description: 'Gestione spedizioni e generazione packing list.',
};

export default async function PackingPage() {
    const jobs = await getAvailableJobsForPacking();
    
    const serializedJobs = JSON.parse(JSON.stringify(jobs));

    return (
        <AuthGuard>
            <AppShell>
                <PackingClientPage initialJobs={serializedJobs} />
            </AppShell>
        </AuthGuard>
    );
}
