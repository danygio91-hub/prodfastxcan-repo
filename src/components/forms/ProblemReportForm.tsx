
"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Send, Loader2, Wrench, Boxes, ShieldCheck, MessageSquare } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";

const problemReportSchema = z.object({
  problemType: z.enum(["FERMO_MACCHINA", "MANCA_MATERIALE", "PROBLEMA_QUALITA", "ALTRO"], {
    required_error: "È necessario selezionare un tipo di problema.",
  }),
  notes: z.string().max(150, { message: "Le note non possono superare i 150 caratteri." }).optional(),
});

type ProblemReportFormValues = z.infer<typeof problemReportSchema>;

interface ProblemReportFormProps {
  onSuccess?: (values: ProblemReportFormValues) => void;
  onCancel?: () => void;
  showTitle?: boolean;
}

export default function ProblemReportForm({ onSuccess, onCancel, showTitle = true }: ProblemReportFormProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const form = useForm<ProblemReportFormValues>({
    resolver: zodResolver(problemReportSchema),
    defaultValues: {
      notes: "",
    },
  });

  const watchedProblemType = form.watch("problemType");

  async function onSubmit(values: ProblemReportFormValues) {
    setIsSubmitting(true);
    // Simulate API call to save the problem
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsSubmitting(false);

    console.log("Problem Report Submitted:", values);
    toast({
      title: "Problema Segnalato",
      description: "La tua segnalazione è stata inviata. La lavorazione è stata bloccata.",
      variant: "destructive",
    });
    
    if (onSuccess) {
      onSuccess(values);
    }
    form.reset();
  }

  return (
    <Card className="w-full shadow-lg border-0 bg-transparent">
       {showTitle && (
        <CardHeader>
          <div className="flex items-center space-x-3">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <div>
              <CardTitle className="text-2xl font-headline">Segnala un Problema di Produzione</CardTitle>
              <CardDescription>La segnalazione bloccherà la commessa fino all'intervento di un supervisore.</CardDescription>
            </div>
          </div>
        </CardHeader>
       )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6 pt-6">
            <FormField
              control={form.control}
              name="problemType"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel className="text-base font-semibold">Qual è il problema?</FormLabel>
                   <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                    >
                      <FormItem>
                        <FormControl>
                          <RadioGroupItem value="FERMO_MACCHINA" id="fermo_macchina" className="sr-only" />
                        </FormControl>
                        <Label htmlFor="fermo_macchina" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer">
                          <Wrench className="mb-3 h-6 w-6" />
                          Fermo Macchina
                        </Label>
                      </FormItem>
                       <FormItem>
                        <FormControl>
                          <RadioGroupItem value="MANCA_MATERIALE" id="manca_materiale" className="sr-only" />
                        </FormControl>
                        <Label htmlFor="manca_materiale" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer">
                          <Boxes className="mb-3 h-6 w-6" />
                          Manca Materiale
                        </Label>
                      </FormItem>
                       <FormItem>
                        <FormControl>
                          <RadioGroupItem value="PROBLEMA_QUALITA" id="problema_qualita" className="sr-only" />
                        </FormControl>
                        <Label htmlFor="problema_qualita" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer">
                          <ShieldCheck className="mb-3 h-6 w-6" />
                          Problema Qualità
                        </Label>
                      </FormItem>
                      <FormItem>
                        <FormControl>
                          <RadioGroupItem value="ALTRO" id="altro" className="sr-only" />
                        </FormControl>
                        <Label htmlFor="altro" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer">
                          <MessageSquare className="mb-3 h-6 w-6" />
                          Altro
                        </Label>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchedProblemType === 'ALTRO' && (
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Note Aggiuntive (Opzionale)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Descrivi brevemente il problema..."
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </CardContent>
          <CardFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>Annulla</Button>
            )}
            <Button type="submit" variant="destructive" className="w-full sm:w-auto" disabled={isSubmitting || !watchedProblemType}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <AlertTriangle className="mr-2 h-4 w-4" />}
              {isSubmitting ? "Invio..." : "Conferma Segnalazione"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
