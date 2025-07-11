
"use client";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function OperatorDataRedirect() {
    const router = useRouter();
    useEffect(() => {
        router.replace('/operator');
    }, [router]);
    return null; // or a loading spinner
}
