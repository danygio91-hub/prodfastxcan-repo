import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { type OverallStatus } from "@/types";

export function StatusBadge({ status }: { status: OverallStatus }) {
  return (
    <Badge
      className={cn(
        "py-1 px-2 text-xs font-semibold tracking-wide",
        status === "Da Iniziare" && "bg-gray-500 text-white hover:bg-gray-500/90",
        status === "In Preparazione" && "bg-cyan-500 text-white hover:bg-cyan-500/90",
        status === "Pronto per Produzione" && "bg-teal-500 text-white hover:bg-teal-500/90",
        status === "Pronto per Finitura" && "bg-indigo-500 text-white hover:bg-indigo-500/90",
        status === "In Lavorazione" && "bg-blue-600 text-white hover:bg-blue-600/90 animate-pulse",
        status === "Completata" && "bg-primary text-primary-foreground hover:bg-primary/90",
        (status === "Problema" || status === "Manca Materiale") && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        status === "Sospesa" && "bg-yellow-500 text-white"
      )}
    >
      {status}
    </Badge>
  );
}
