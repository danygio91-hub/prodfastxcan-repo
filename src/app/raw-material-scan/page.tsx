
"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// This page is obsolete and has been replaced by two new pages:
// 1. /material-loading: For MAG/Superadvisor to load new stock.
// 2. /scan-job: Where material consumption is now handled within a job's context.
// This component redirects any old bookmarks to the main dashboard.
export default function ObsoleteRawMaterialScanRedirect() {
    const router = useRouter();
    useEffect(() => {
        router.replace('/dashboard');
    }, [router]);
    return null; // or a loading spinner
}
