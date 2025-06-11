
"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Users, ScanLine, AlertTriangle, ArrowRight, Clock } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface DashboardItemProps {
  title: string;
  description: string;
  icon: React.ElementType;
  href?: string;
  onItemClick?: () => void; // Per click custom non-dialog
  isDialogTrigger?: boolean;
  // Per accettare i props da AlertDialogTrigger asChild
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>; // Per AlertDialogTrigger
  // Permette di passare altri props HTML standard
  [key: string]: any;
}

const DashboardItem: React.FC<DashboardItemProps> = ({ 
  title, 
  description, 
  icon: Icon, 
  href, 
  onItemClick, 
  isDialogTrigger, 
  className: propClassName,
  onClick: triggerOnClick, // onClick fornito da AlertDialogTrigger (o altro wrapper)
  ...rest 
}) => {
  const content = (
    <>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <Icon className="h-10 w-10 text-accent" />
          {(href || onItemClick || isDialogTrigger || triggerOnClick) && (
             <Button 
                variant="ghost" 
                size="icon" 
                className="text-accent hover:bg-accent/10" 
                // La freccia è principalmente decorativa se l'intera card è il trigger.
                // Se è un item autonomo con onItemClick, la freccia può anche chiamare onItemClick.
                onClick={(!isDialogTrigger && onItemClick) ? (e) => { e.stopPropagation(); onItemClick(); } : undefined}
                aria-hidden={isDialogTrigger || triggerOnClick ? true : undefined}
                tabIndex={isDialogTrigger || triggerOnClick ? -1 : undefined}
             >
              <ArrowRight className="h-5 w-5" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <CardTitle className="text-xl font-headline mb-1">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardContent>
    </>
  );

  const cardBaseClasses = "hover:shadow-lg transition-shadow duration-300 h-full";
  const isClickable = href || onItemClick || triggerOnClick || isDialogTrigger;
  const finalCardClassName = cn(cardBaseClasses, { 'cursor-pointer': isClickable }, propClassName);

  if (href && !isDialogTrigger) {
    return (
      <Link href={href} passHref className={cn("block", propClassName)} {...rest}>
        <Card className={finalCardClassName}>
          {content}
        </Card>
      </Link>
    );
  }

  // Usa triggerOnClick (es. da AlertDialogTrigger) se presente, altrimenti onItemClick (custom).
  // Passa anche ...rest per altri props come aria-attributes.
  return (
    <Card className={finalCardClassName} onClick={triggerOnClick || onItemClick} {...rest}>
      {content}
    </Card>
  );
};

export default function DashboardPage() {
  const { toast } = useToast();
  const [isClockDialogOpen, setIsClockDialogOpen] = useState(false);

  const handleClockIn = () => {
    toast({
      title: "Timbratura Registrata",
      description: "Ingresso registrato con successo.",
    });
    setIsClockDialogOpen(false);
  };

  const handleClockOut = () => {
    toast({
      title: "Timbratura Registrata",
      description: "Uscita registrata con successo.",
    });
    setIsClockDialogOpen(false);
  };

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">
              Access core functions of ProdTime Tracker.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <DashboardItem
              title="Operator Data"
              description="View and manage operator information."
              icon={Users}
              href="/operator-data"
            />
            <DashboardItem
              title="Scan Job Order"
              description="Scan a job order barcode to start or continue work."
              icon={ScanLine}
              href="/scan-job"
            />
            <DashboardItem
              title="Report Problem"
              description="Report any issues encountered during production."
              icon={AlertTriangle}
              href="/report-problem"
            />
            
            <AlertDialog open={isClockDialogOpen} onOpenChange={setIsClockDialogOpen}>
              <AlertDialogTrigger asChild>
                <DashboardItem
                  title="Timbratrice"
                  description="Registra il tuo orario di entrata o uscita."
                  icon={Clock}
                  isDialogTrigger={true}
                  // L'onClick che apriva il dialogo è stato rimosso qui.
                  // AlertDialogTrigger asChild fornirà l'onClick corretto al DashboardItem.
                />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Seleziona Azione Timbratura</AlertDialogTitle>
                  <AlertDialogDescription>
                    Vuoi registrare un orario di ingresso o di uscita?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annulla</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClockIn}>
                    Registra Entrata
                  </AlertDialogAction>
                  <AlertDialogAction onClick={handleClockOut}>
                    Registra Uscita
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
