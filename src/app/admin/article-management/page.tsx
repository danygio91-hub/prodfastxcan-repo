
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { getArticles } from './actions';
import { getRawMaterials } from '../raw-material-management/actions';
import ArticleManagementClientPage from './ArticleManagementClientPage';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: { [key: string]: string | string[] | undefined };
}

export default async function ArticleManagementPage({ searchParams }: PageProps) {
  const rawSearch = searchParams?.search || searchParams?.q || searchParams?.code;
  const initialSearch = typeof rawSearch === 'string' ? rawSearch.trim() : undefined;

  const initialArticles = await getArticles(initialSearch);

  return (
    <AdminAuthGuard>
      <AppShell>
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-4 text-muted-foreground">Caricamento articoli...</p>
          </div>
        }>
          <ArticleManagementClientPage initialArticles={initialArticles} />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
