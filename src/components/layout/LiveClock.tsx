
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
    
    const timeOptions: Intl.DateTimeFormatOptions = {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Europe/Rome',
    };

    const dateOptions: Intl.DateTimeFormatOptions = {
        day: '2-digit',
        month: '2-digit',
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
        <div className="w-full bg-card border rounded-lg p-2 flex items-center justify-center sm:justify-between flex-wrap gap-x-4 gap-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
                <Calendar className="h-4 w-4" />
                <span>{dateString}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
                <Clock className="h-4 w-4" />
                <span>{timeString}</span>
                <span className="text-xs font-sans bg-muted px-1.5 py-0.5 rounded-sm">{tzString}</span>
            </div>
        </div>
    );
}
