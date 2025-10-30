
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
            setInstallPrompt(e as BeforeInstallallPromptEvent);
        };
        
        if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
            const wb = new (window as any).Workbox('/sw.js');

            wb.addEventListener('waiting', (event: any) => {
                const promptUserToUpdate = () => {
                    toast({
                        title: "Aggiornamento Disponibile",
                        description: "È disponibile una nuova versione dell'app.",
                        duration: Infinity, // Keep the toast open until user acts
                        action: (
                            <ToastAction altText="Aggiorna" onClick={() => {
                                wb.addEventListener('controlling', () => {
                                    window.location.reload();
                                });
                                wb.messageSkipWaiting();
                            }}>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Aggiorna
                            </ToastAction>
                        ),
                    });
                };
                promptUserToUpdate();
            });

            wb.register();
        }

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
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

    if (!installPrompt) {
        return null; // Do not render the install button if not applicable
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
