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
  description: z.string().min(10, { message: "Description must be at least 10 characters." }).max(500, { message: "Description must be 500 characters or less." }),
  severity: z.enum(["low", "medium", "high"], { required_error: "Severity is required." }),
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
      title: "Problem Reported",
      description: "Your report has been submitted successfully.",
    });
    form.reset();
  }

  return (
    <Card className="w-full shadow-lg">
       <CardHeader>
        <div className="flex items-center space-x-3">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <div>
            <CardTitle className="text-2xl font-headline">Report a Production Problem</CardTitle>
            <CardDescription>Describe the issue you encountered during production.</CardDescription>
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
                  <FormLabel>Problem Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Clearly describe the problem, including any relevant details like machine number, job order, or specific symptoms."
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
                  <FormLabel>Severity Level</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select severity level" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="low">Low (Minor issue, no immediate impact)</SelectItem>
                      <SelectItem value="medium">Medium (Moderate impact, requires attention)</SelectItem>
                      <SelectItem value="high">High (Critical issue, production stopped or major defect)</SelectItem>
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
              {isSubmitting ? "Submitting..." : "Submit Report"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
