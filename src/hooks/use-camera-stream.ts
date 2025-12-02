
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from './use-toast';

export function useCameraStream(shouldBeActive: boolean, videoRef: React.RefObject<HTMLVideoElement>) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { toast } = useToast();

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!shouldBeActive) {
      stopCamera();
      return;
    }

    const requestCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setHasPermission(true);
      } catch (error) {
        console.error('Error accessing camera:', error);
        setHasPermission(false);
        toast({
          variant: 'destructive',
          title: 'Errore Fotocamera',
          description: 'Accesso negato o non disponibile. Controlla i permessi del browser.',
        });
        stopCamera();
      }
    };

    requestCamera();

    return () => stopCamera();
  }, [shouldBeActive, videoRef, stopCamera, toast]);

  return { hasPermission, streamRef };
}
