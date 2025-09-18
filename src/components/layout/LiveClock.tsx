
"use client";

import React, { useState, useEffect } from 'react';
import { Calendar, Clock } from 'lucide-react';

export default function LiveClock() {
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);

        return () => {
            clearInterval(timer);
        };
    }, []);
    
    // Formatting options to ensure Italian locale and correct timezone display
    const timeOptions: Intl.DateTimeFormatOptions = {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Europe/Rome',
    };

    const dateOptions: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Rome',
    };
    
    const timezoneOptions: Intl.DateTimeFormatOptions = {
        timeZoneName: 'short',
        timeZone: 'Europe/Rome',
    };

    const timeString = currentTime.toLocaleTimeString('it-IT', timeOptions);
    const dateString = currentTime.toLocaleDateString('it-IT', dateOptions);
    const tzString = currentTime.toLocaleDateString('it-IT', timezoneOptions).split(' ')[1];


    return (
        <div className="hidden sm:flex items-center gap-4 text-sm text-muted-foreground border-l border-border pl-4">
            <div className="hidden xl:flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span className="capitalize">{dateString}</span>
            </div>
            <div className="flex items-center gap-2 font-mono">
                <Clock className="h-4 w-4" />
                <span>{timeString}</span>
                <span className="text-xs font-sans bg-muted px-1.5 py-0.5 rounded-sm">{tzString}</span>
            </div>
        </div>
    );
}
