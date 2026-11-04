"use client";

import * as React from "react";
import { format, isValid } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn, formatToDateInputMask, parseRobustDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface MaskedDatePickerProps {
  value?: Date | null;
  onChange: (date?: Date | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function MaskedDatePicker({
  value,
  onChange,
  placeholder = "GG/MM/AAAA",
  className,
  disabled
}: MaskedDatePickerProps) {
  // Use internal state for the input value to handle masking correctly
  const [inputValue, setInputValue] = React.useState<string>("");

  // Sync internal input value when the external 'value' prop changes
  React.useEffect(() => {
    if (value && isValid(value)) {
      const formatted = format(value, "dd/MM/yyyy");
      if (formatted !== inputValue) {
        setInputValue(formatted);
      }
    } else if (!value) {
      setInputValue("");
    }
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    const formatted = formatToDateInputMask(rawVal);
    setInputValue(formatted);
    
    // When the input is complete (10 characters: GG/MM/AAAA), try to parse and trigger onChange
    if (formatted.length === 10) {
      const parsedDate = parseRobustDate(formatted);
      if (parsedDate && isValid(parsedDate)) {
        const currentRef = value ? format(value, "dd/MM/yyyy") : "";
        if (formatted !== currentRef) {
          onChange(parsedDate);
        }
      } else {
        onChange(null);
      }
    } 
    // Handle clear
    else if (formatted.length === 0) {
      onChange(null);
    }
    // For intermediate lengths, if value was set, clear it to avoid stale valid dates
    else if (value) {
      onChange(null);
    }
  };

  return (
    <div className="relative flex items-center w-full">
      <input
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={10}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-xs transition-colors",
          "text-gray-900 dark:text-gray-100", // Testo digitato sempre ad alto contrasto
          "placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:opacity-100", // Placeholder ben visibile
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50 pr-7 font-mono",
          // Se la classe include uno sfondo rosso chiaro (bg-red-50), forza colore scuro per evitare testo bianco su bianco
          className?.includes("bg-red-50") && "text-gray-900 font-medium",
          className
        )}
      />
      <div className="absolute right-0 flex items-center pr-1 h-full">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-muted p-0"
              disabled={disabled}
              type="button"
            >
              <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="sr-only">Apri calendario</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={value || undefined}
              onSelect={(date) => {
                if (date && isValid(date)) {
                  setInputValue(format(date, "dd/MM/yyyy"));
                  onChange(date);
                } else {
                  setInputValue("");
                  onChange(null);
                }
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
