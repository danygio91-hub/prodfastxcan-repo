
"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// This component is kept for backward compatibility in case of bookmarks.
// It redirects from the old /operator-nav-menu route to the new /dashboard route.
export default function OperatorNavRedirect() {
    const router = useRouter();
    useEffect(() => {
        router.replace('/dashboard');
    }, [router]);
    return null; // or a loading spinner
}
