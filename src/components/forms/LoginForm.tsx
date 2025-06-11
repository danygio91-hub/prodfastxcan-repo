
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
import { login, isAdmin as checkIsAdmin } from "@/lib/auth"; // Renamed isAdmin to checkIsAdmin to avoid conflict
import { useToast } from "@/hooks/use-toast";
import { Lock, LogIn, Clock, ScanBarcode, User } from "lucide-react";

const formSchema = z.object({
  username: z.string().min(1, { message: "Username is required." }), // Added username field
  password: z.string().min(1, { message: "Password is required." }),
});

export default function LoginForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(false);
  // Barcode scanning logic removed for simplicity for now, admin login will use username/password
  // const [scannedOperatorName, setScannedOperatorName] = React.useState<string | null>(null);
  // const [isScanningBarcode, setIsScanningBarcode] = React.useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  // const handleSimulateBarcodeScan = () => {
  //   setIsScanningBarcode(true);
  //   setTimeout(() => {
  //     setScannedOperatorName("Daniel"); // Default to Daniel for barcode scan simulation
  //     setIsScanningBarcode(false);
  //     form.setValue("username", "Daniel", { shouldValidate: true });
  //     toast({
  //       title: "Barcode Scanned",
  //       description: "Operator: Daniel identified. Please enter your password.",
  //     });
  //   }, 1000);
  // };

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    const success = await login(values.username, values.password);
    setIsLoading(false);

    if (success) {
      toast({
        title: "Login Successful",
        description: `Welcome, ${values.username}!`,
      });
      if (checkIsAdmin()) {
        router.push("/admin/dashboard");
      } else {
        router.push("/dashboard");
      }
    } else {
      toast({
        title: "Login Failed",
        description: "Invalid credentials.",
        variant: "destructive",
      });
      form.setError("password", { type: "manual", message: "Invalid username or password." });
    }
  }

  return (
    <Card className="w-full max-w-md shadow-xl border-border/50 bg-card">
      <CardHeader className="items-center text-center">
        <Clock className="h-16 w-16 text-primary mb-4" />
        <CardTitle className="text-3xl font-headline text-foreground">ProdFast Tracker</CardTitle>
        <CardDescription className="text-muted-foreground">Please enter your credentials.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6 pt-2">
            {/* Barcode scanning UI removed for simpler username/password login for now
            <div className="space-y-2">
              <Label className="flex items-center text-foreground/80">
                <ScanBarcode className="mr-2 h-6 w-6 text-primary" />
                Operator Barcode (or enter Username below)
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
                        form.resetField("username");
                        form.resetField("password");
                         toast({ title: "Barcode scan reset", description: "Please scan your barcode or enter username."});
                    }}
                    className="w-full mt-2"
                    variant="link"
                    size="sm"
                >
                    Clear Scanned Barcode / Enter Manually
                </Button>
              )}
            </div>
            */}
             <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center text-foreground/80">
                    <User className="mr-2 h-6 w-6 text-primary" />
                    Username
                  </FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Enter your username" 
                      {...field} 
                      className="bg-input text-foreground placeholder:text-muted-foreground/80"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
              disabled={isLoading}
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
