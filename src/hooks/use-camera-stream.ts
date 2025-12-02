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
       if (videoRef.current) {
          videoRef.current.srcObject = null;
      }
    }
  }, [videoRef]);

  useEffect(() => {
    if (!shouldBeActive) {
      stopCamera();
      return;
    }

    let isCancelled = false;

    const requestCamera = async () => {
      if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
        toast({
          variant: 'destructive',
          title: 'Funzionalità non Supportata',
          description: 'Il tuo browser non supporta l\'accesso alla fotocamera.',
        });
        setHasPermission(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (isCancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = stream;
        setHasPermission(true);
        
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
            // The `play()` call might fail if the video element is not yet ready.
            // It's often better to rely on the `autoPlay` attribute on the video tag itself.
            videoRef.current.play().catch(e => console.error("Video play failed:", e));
        }

      } catch (error) {
        if (isCancelled) return;
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

    return () => {
      isCancelled = true;
      stopCamera();
    };
  }, [shouldBeActive, videoRef, stopCamera, toast]);

  return { hasPermission };
}
