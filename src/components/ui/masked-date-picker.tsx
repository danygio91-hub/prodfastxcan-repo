"use client";

import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { IMaskInput } from "react-imask";
import { IMask } from "react-imask";

import { cn } from "@/lib/utils";
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

  const handleInputChange = (val: string) => {
    setInputValue(val);
    
    // When the input is complete (10 characters), try to parse and trigger onChange
    if (val.length === 10) {
      const parsedDate = parse(val, "dd/MM/yyyy", new Date());
      if (isValid(parsedDate)) {
        // Trigger external change only if it's a valid date
        onChange(parsedDate);
      } else {
        // If the date is invalid (e.g. 31/02/2024), we pass null to the form controller
        onChange(null);
      }
    } 
    // Handle clear
    else if (val.length === 0 || val === "__/__/____") {
      onChange(null);
    }
    // For intermediate lengths, we don't trigger onChange to avoid partial/invalid dates in the form state
    // unless the field was already populated and is being cleared
    else if (value) {
        onChange(null);
    }
  };

  return (
    <div className={cn("relative flex items-center w-full", className)}>
      <IMaskInput
        mask="00/00/0000"
        value={inputValue}
        unmask={false}
        onAccept={(val: string) => handleInputChange(val)}
        placeholder={placeholder}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pr-10",
          className
        )}
        disabled={disabled}
      />
      <div className="absolute right-0 flex items-center pr-1 h-full">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:bg-muted"
              disabled={disabled}
              type="button"
            >
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              <span className="sr-only">Apri calendario</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={value || undefined}
              onSelect={(date) => {
                onChange(date || null);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
