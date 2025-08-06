
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ListChecks } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gradient-to-br from-background to-secondary/30">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
            <div className="mx-auto bg-primary text-primary-foreground rounded-full h-16 w-16 flex items-center justify-center mb-4">
                <ListChecks className="h-8 w-8" />
            </div>
            <CardTitle className="text-2xl font-headline">Benvenuto nella tua App</CardTitle>
            <CardDescription>
                Questa è la pagina iniziale. Inizia a personalizzare la tua applicazione.
            </CardDescription>
        </CardHeader>
        <CardContent>
            <Link href="/dashboard" className="block">
                <Button className="w-full">
                    Vai alla Dashboard
                </Button>
            </Link>
        </CardContent>
      </Card>
    </main>
  );
}
