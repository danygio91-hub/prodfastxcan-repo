
"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Send } from "lucide-react";

const problemReportSchema = z.object({
  description: z.string().min(10, { message: "La descrizione deve contenere almeno 10 caratteri." }).max(500, { message: "La descrizione deve contenere al massimo 500 caratteri." }),
  severity: z.enum(["low", "medium", "high"], { required_error: "La gravità è richiesta." }),
});

export default function ProblemReportForm() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const form = useForm<z.infer<typeof problemReportSchema>>({
    resolver: zodResolver(problemReportSchema),
    defaultValues: {
      description: "",
      severity: undefined,
    },
  });

  async function onSubmit(values: z.infer<typeof problemReportSchema>) {
    setIsSubmitting(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsSubmitting(false);

    console.log("Problem Report Submitted:", values);
    toast({
      title: "Problema Segnalato",
      description: "La tua segnalazione è stata inviata con successo.",
    });
    form.reset();
  }

  return (
    <Card className="w-full shadow-lg">
       <CardHeader>
        <div className="flex items-center space-x-3">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <div>
            <CardTitle className="text-2xl font-headline">Segnala un Problema di Produzione</CardTitle>
            <CardDescription>Descrivi il problema riscontrato durante la produzione.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrizione del Problema</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Descrivi chiaramente il problema, includendo dettagli rilevanti come numero macchina, commessa o sintomi specifici."
                      rows={5}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="severity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Livello di Gravità</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleziona livello di gravità" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="low">Basso (Problema minore, nessun impatto immediato)</SelectItem>
                      <SelectItem value="medium">Medio (Impatto moderato, richiede attenzione)</SelectItem>
                      <SelectItem value="high">Alto (Problema critico, produzione ferma o difetto grave)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              <Send className="mr-2 h-4 w-4" />
              {isSubmitting ? "Invio in corso..." : "Invia Segnalazione"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
