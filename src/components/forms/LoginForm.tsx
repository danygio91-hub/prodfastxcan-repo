
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
import { User, Lock, LogIn, Clock } from "lucide-react";

const formSchema = z.object({
  operatorName: z.string().min(1, { message: "Operator name is required." }),
  password: z.string().min(1, { message: "Password is required." }),
});

export default function LoginForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      operatorName: "",
      password: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    const success = await login(values.operatorName, values.password);
    setIsLoading(false);

    if (success) {
      toast({
        title: "Login Successful",
        description: `Welcome, ${values.operatorName}!`,
      });
      router.push("/dashboard");
    } else {
      toast({
        title: "Login Failed",
        description: "Invalid operator name or password.",
        variant: "destructive",
      });
      form.setError("operatorName", { type: "manual", message: " " });
      form.setError("password", { type: "manual", message: "Invalid credentials" });
    }
  }

  return (
    <Card className="w-full max-w-md shadow-xl border-border/50 bg-card">
      <CardHeader className="items-center text-center">
        <Clock className="h-16 w-16 text-primary mb-4" />
        <CardTitle className="text-3xl font-headline text-foreground">ProdTime Tracker</CardTitle>
        <CardDescription className="text-muted-foreground">Please enter your credentials to log in.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6 pt-2">
            <FormField
              control={form.control}
              name="operatorName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center text-foreground/80">
                    <User className="mr-2 h-6 w-6 text-primary" />
                    Operator Name
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="Enter your operator name" {...field} className="bg-input text-foreground placeholder:text-muted-foreground/80" />
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
                    <Input type="password" placeholder="Enter your password" {...field} className="bg-input text-foreground placeholder:text-muted-foreground/80" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground" disabled={isLoading}>
              <LogIn className="mr-2 h-5 w-5" />
              {isLoading ? "Logging in..." : "Login"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
