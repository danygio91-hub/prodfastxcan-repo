'use client';

import { useEffect, useState, useRef } from 'react';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';

export function AutoUpdater() {
    const [currentBuildId, setCurrentBuildId] = useState<string | null>(null);
    const { toast } = useToast();
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const hasNotified = useRef(false);

    useEffect(() => {
        const fetchInitialVersion = async () => {
            try {
                const res = await fetch('/api/version');
                if (res.ok) {
                    const data = await res.json();
                    if (data.buildId && data.buildId !== 'development' && data.buildId !== 'error') {
                        setCurrentBuildId(data.buildId);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch initial version", e);
            }
        };

        fetchInitialVersion();
    }, []);

    useEffect(() => {
        if (!currentBuildId) return;

        const checkForUpdates = async () => {
            if (hasNotified.current) return;

            try {
                const res = await fetch('/api/version', { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    const newBuildId = data.buildId;

                    if (newBuildId && newBuildId !== 'development' && newBuildId !== 'error' && newBuildId !== currentBuildId) {
                        hasNotified.current = true;
                        toast({
                            title: "Aggiornamento Disponibile",
                            description: "Termina l'operazione in corso e ricarica per applicare le novità.",
                            duration: 86400000, // 24 hours (persistent)
                            action: (
                                <ToastAction 
                                    altText="Ricarica Pagina" 
                                    onClick={() => window.location.reload()}
                                    className="bg-blue-600 text-white hover:bg-blue-700 font-bold px-4 border-0"
                                >
                                    Ricarica
                                </ToastAction>
                            ),
                            className: "bg-slate-900 border-blue-500 border-2 text-white shadow-2xl shadow-blue-900/50",
                        });
                    }
                }
            } catch (e) {
                console.error("Failed to check for updates", e);
            }
        };

        // Poll every 3 minutes
        intervalRef.current = setInterval(checkForUpdates, 180 * 1000);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [currentBuildId, toast]);

    return null;
}
