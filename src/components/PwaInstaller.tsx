
"use client";

import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Download, RefreshCw } from 'lucide-react';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from './ui/toast';

// Add type for the install prompt event
interface BeforeInstallPromptEvent extends Event {
    readonly platforms: Array<string>;
    readonly userChoice: Promise<{
        outcome: 'accepted' | 'dismissed';
        platform: string;
    }>;
    prompt(): Promise<void>;
}

const PwaInstaller = () => {
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setInstallPrompt(e as BeforeInstallPromptEvent);
        };

        const setupServiceWorker = async () => {
            if ('serviceWorker' in navigator) {
                try {
                    // Always try to register in development for easier testing if needed, 
                    // or keep it production-only if that's the intention.
                    // The user's original code had a check for Workbox on window.
                    // If we use workbox-sw.js in sw.js, we should still be able to register it manually.
                    
                    const registration = await navigator.serviceWorker.register('/sw.js');
                    console.log('Service Worker registered with scope:', registration.scope);

                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        if (newWorker) {
                            newWorker.addEventListener('statechange', () => {
                                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    toast({
                                        title: "Aggiornamento Disponibile",
                                        description: "È disponibile una nuova versione dell'app. Ricarica per aggiornare.",
                                        action: (
                                            <ToastAction altText="Aggiorna" onClick={() => window.location.reload()}>
                                                <RefreshCw className="mr-2 h-4 w-4" />
                                                Aggiorna
                                            </ToastAction>
                                        ),
                                    });
                                }
                            });
                        }
                    });
                } catch (error) {
                    console.error('Service Worker registration failed:', error);
                }
            }
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('load', setupServiceWorker);


        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('load', setupServiceWorker);
        };
    }, [toast]);

    const handleInstallClick = async () => {
        if (!installPrompt) {
            toast({
                title: "Installazione non disponibile",
                description: "L'app potrebbe essere già installata o il tuo browser non supporta questa funzionalità.",
                variant: "default",
            });
            return;
        }
        await installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        if (outcome === 'accepted') {
            toast({ title: "Installazione Avviata", description: "L'app verrà aggiunta alla tua schermata principale." });
        }
        setInstallPrompt(null);
    };

    if (!installPrompt || window.location.pathname === '/') {
        return null; // Do not render if not applicable or if on the login page (handled there)
    }

    return (
        <div className="fixed bottom-16 right-4 z-50">
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            onClick={handleInstallClick}
                            variant="default"
                            size="icon"
                            className="h-12 w-12 rounded-full bg-green-600 hover:bg-green-700 text-white shadow-lg"
                        >
                            <Download className="h-6 w-6" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Installa l'app sul tuo dispositivo</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </div>
    );
};

export default PwaInstaller;
