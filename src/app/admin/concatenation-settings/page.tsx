
"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// This page is obsolete and has been removed as per user request.
// The feature for automatic group dissolution has been replaced by manual controls.
export default function ObsoleteConcatenationSettingsRedirect() {
    const router = useRouter();
    useEffect(() => {
        router.replace('/admin/settings');
    }, [router]);
    return null; // or a loading spinner
}
