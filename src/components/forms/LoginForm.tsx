
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { login } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Lock, LogIn, Clock, ScanBarcode } from "lucide-react";

const formSchema = z.object({
  password: z.string().min(1, { message: "Password is required." }),
});

export default function LoginForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(false);
  const [scannedOperatorName, setScannedOperatorName] = React.useState<string | null>(null);
  const [isScanningBarcode, setIsScanningBarcode] = React.useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      password: "",
    },
  });

  const handleSimulateBarcodeScan = () => {
    setIsScanningBarcode(true);
    // Simulate barcode scanning process
    setTimeout(() => {
      // For testing, we'll assume the barcode scan identifies "Daniel"
      setScannedOperatorName("Daniel");
      setIsScanningBarcode(false);
      toast({
        title: "Barcode Scanned",
        description: "Operator: Daniel identified. Please enter your password.",
      });
    }, 1000);
  };

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!scannedOperatorName) {
      toast({
        title: "Barcode Scan Required",
        description: "Please scan your personal barcode before logging in.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    const success = await login(scannedOperatorName, values.password);
    setIsLoading(false);

    if (success) {
      toast({
        title: "Login Successful",
        description: `Welcome, ${scannedOperatorName}!`,
      });
      router.push("/dashboard");
    } else {
      toast({
        title: "Login Failed",
        description: "Invalid credentials or barcode scan mismatch.",
        variant: "destructive",
      });
      form.setError("password", { type: "manual", message: "Invalid password for the scanned operator." });
    }
  }

  return (
    <Card className="w-full max-w-md shadow-xl border-border/50 bg-card">
      <CardHeader className="items-center text-center">
        <Clock className="h-16 w-16 text-primary mb-4" />
        <CardTitle className="text-3xl font-headline text-foreground">ProdTime Tracker</CardTitle>
        <CardDescription className="text-muted-foreground">Please scan your personal barcode and enter your password.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6 pt-2">
            <div className="space-y-2">
              <Label className="flex items-center text-foreground/80">
                <ScanBarcode className="mr-2 h-6 w-6 text-primary" />
                Operator Barcode
              </Label>
              <Button
                type="button"
                onClick={handleSimulateBarcodeScan}
                className="w-full"
                variant="outline"
                disabled={isScanningBarcode || !!scannedOperatorName}
              >
                {isScanningBarcode
                  ? "Scanning..."
                  : scannedOperatorName
                  ? `Operator: ${scannedOperatorName} (Scanned)`
                  : "Scan Personal Barcode"}
              </Button>
              {scannedOperatorName && (
                 <Button
                    type="button"
                    onClick={() => {
                        setScannedOperatorName(null);
                        form.resetField("password");
                         toast({ title: "Barcode scan reset", description: "Please scan your barcode again."});
                    }}
                    className="w-full mt-2"
                    variant="link"
                    size="sm"
                >
                    Scan different barcode
                </Button>
              )}
            </div>
            
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center text-foreground/80">
                    <Lock className="mr-2 h-6 w-6 text-primary" />
                    Password
                  </FormLabel>
                  <FormControl>
                    <Input 
                      type="password" 
                      placeholder="Enter your personal password" 
                      {...field} 
                      className="bg-input text-foreground placeholder:text-muted-foreground/80" 
                      disabled={!scannedOperatorName || isScanningBarcode}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <Button 
              type="submit" 
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground" 
              disabled={isLoading || !scannedOperatorName || isScanningBarcode}
            >
              <LogIn className="mr-2 h-5 w-5" />
              {isLoading ? "Logging in..." : "Login"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
