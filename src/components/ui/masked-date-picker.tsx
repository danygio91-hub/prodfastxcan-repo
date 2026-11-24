"use client";

import * as React from "react";
import { format, isValid } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn, commitDateInputMask, formatToDateInputMask, stepDateInputMask } from "@/lib/utils";
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
  id?: string;
  disabledDate?: (date: Date) => boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>, committedDate?: Date | null) => void;
}

export function MaskedDatePicker({
  value,
  onChange,
  placeholder = "GG/MM/AAAA",
  className,
  disabled,
  id,
  disabledDate,
  onKeyDown,
}: MaskedDatePickerProps) {
  const [inputValue, setInputValue] = React.useState<string>("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isEditingRef = React.useRef(false);
  const hasTypedSinceFocusRef = React.useRef(false);

  // Sync internal input value when external 'value' changes ONLY when not actively typing
  React.useEffect(() => {
    const isFocused =
      isEditingRef.current ||
      (typeof document !== "undefined" && document.activeElement === inputRef.current);
    if (isFocused) return;

    if (value && isValid(value)) {
      const formatted = format(value, "dd/MM/yyyy");
      if (formatted !== inputValue) {
        setInputValue(formatted);
      }
    } else if (!value) {
      setInputValue("");
    }
  }, [value, inputValue]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    hasTypedSinceFocusRef.current = true;
    const rawVal = e.target.value;
    const { formatted, completeDate } = stepDateInputMask(rawVal);
    setInputValue(formatted);

    if (completeDate && isValid(completeDate)) {
      const currentRef = value && isValid(value) ? format(value, "dd/MM/yyyy") : "";
      if (formatted !== currentRef) {
        onChange(completeDate);
      }
    } else if (formatted.length === 0) {
      onChange(null);
    }
    // Non chiamare onChange(null) sulle lunghezze intermedie (1..9), evitando che useEffect([value]) azzeri la prima cifra
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    isEditingRef.current = true;
    hasTypedSinceFocusRef.current = false;
    const target = e.currentTarget;
    target.select();
    requestAnimationFrame(() => {
      if (!hasTypedSinceFocusRef.current && document.activeElement === target) {
        target.select();
      }
    });
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    isEditingRef.current = false;
    const { formatted, committedDate } = commitDateInputMask(e.currentTarget.value, value);
    setInputValue(formatted);

    const currentFormatted = value && isValid(value) ? format(value, "dd/MM/yyyy") : "";
    const committedFormatted =
      committedDate && isValid(committedDate) ? format(committedDate, "dd/MM/yyyy") : "";
    if (committedFormatted !== currentFormatted) {
      onChange(committedDate);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey) {
      onKeyDown?.(e);
      return;
    }

    if (e.key === "Enter") {
      const { formatted, committedDate } = commitDateInputMask(e.currentTarget.value, value);
      setInputValue(formatted);
      const currentFormatted = value && isValid(value) ? format(value, "dd/MM/yyyy") : "";
      const committedFormatted =
        committedDate && isValid(committedDate) ? format(committedDate, "dd/MM/yyyy") : "";
      if (committedFormatted !== currentFormatted) {
        onChange(committedDate);
      }
      onKeyDown?.(e, committedDate);
      return;
    }

    if (/^[0-9]$/.test(e.key)) {
      hasTypedSinceFocusRef.current = true;
      const target = e.currentTarget;
      // Se non c'è selezione e la lunghezza è già al limite (10), sovrascriviamo partendo dalla prima cifra senza svuotare il valore padre
      if (target.selectionStart === target.selectionEnd && target.value.length >= 10) {
        if (target.selectionStart === 0 || target.selectionStart === 10) {
          e.preventDefault();
          const formatted = formatToDateInputMask(e.key);
          setInputValue(formatted);
          requestAnimationFrame(() => {
            target.setSelectionRange(formatted.length, formatted.length);
          });
        }
      }
      return;
    }

    onKeyDown?.(e);
  };

  return (
    <div className="relative flex items-center w-full">
      <input
        ref={inputRef}
        id={id}
        data-masked-date="true"
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={10}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-xs transition-colors",
          "text-gray-900 dark:text-gray-100",
          "placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:opacity-100",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50 pr-7 font-mono",
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
              tabIndex={-1}
            >
              <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="sr-only">Apri calendario</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={value || undefined}
              disabled={disabledDate}
              onSelect={(date) => {
                isEditingRef.current = false;
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
