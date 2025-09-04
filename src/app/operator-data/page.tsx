

"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// This component is kept for backward compatibility in case of bookmarks.
// It redirects from the old /operator-data route to the new /operator route.
export default function OperatorDataRedirect() {
    const router = useRouter();
    useEffect(() => {
        router.replace('/operator');
    }, [router]);
    return null; // or a loading spinner
}
