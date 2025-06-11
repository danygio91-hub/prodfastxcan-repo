
"use client";

import * as React from "react";
import Image from 'next/image';
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { login, isAdmin as checkIsAdmin } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Lock, LogIn, User } from "lucide-react";

const formSchema = z.object({
  username: z.string().min(1, { message: "Il nome utente è obbligatorio." }), 
  password: z.string().min(1, { message: "La password è obbligatoria." }),
});

export default function LoginForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    const success = await login(values.username, values.password);
    setIsLoading(false);

    if (success) {
      toast({
        title: "Accesso Riuscito",
        description: `Benvenuto, ${values.username}!`,
      });
      if (checkIsAdmin()) {
        router.push("/admin/dashboard");
      } else {
        router.push("/dashboard");
      }
    } else {
      toast({
        title: "Accesso Fallito",
        description: "Credenziali non valide.",
        variant: "destructive",
      });
      form.setError("password", { type: "manual", message: "Nome utente o password non validi." });
    }
  }

  return (
    <Card className="w-full max-w-md shadow-xl border-border/50 bg-card">
      <CardHeader className="items-center text-center">
        <Image src="/logo.svg" alt="Logo ProdFast" width={90} height={60} className="mb-6" />
        <CardTitle className="text-3xl font-headline text-foreground">ProdFast Tracker</CardTitle>
        <CardDescription className="text-muted-foreground">Inserisci le tue credenziali.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6 pt-2">
             <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center text-foreground/80">
                    <User className="mr-2 h-6 w-6 text-primary" />
                    Nome Utente
                  </FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Inserisci il tuo nome utente" 
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
                      placeholder="Inserisci la tua password personale" 
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
              {isLoading ? "Accesso in corso..." : "Accedi"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
