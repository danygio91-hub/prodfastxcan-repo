import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { type OverallStatus } from "@/types";

export function StatusBadge({ status }: { status: OverallStatus }) {
  return (
    <Badge
      className={cn(
        "py-1 px-2 text-[10px] font-black tracking-widest uppercase rounded-lg border-none shadow-sm",
        (status === "DA INIZIARE" || status === "Da Iniziare") && "bg-slate-400 text-white",
        (status === "IN PREP." || status === "In Preparazione") && "bg-amber-500 text-white",
        (status === "PRONTO PROD." || status === "Pronto per Produzione") && "bg-emerald-500 text-white",
        (status === "IN PROD." || status === "In Lavorazione") && "bg-blue-600 text-white animate-pulse",
        (status === "FINE PROD." || status === "Pronto per Finitura") && "bg-purple-600 text-white",
        status === "QLTY & PACK" && "bg-pink-600 text-white",
        (status === "CHIUSO" || status === "Completata") && "bg-slate-950 text-white",
        status === "In Pianificazione" && "bg-slate-500 text-white",
        (status === "Problema" || status === "Manca Materiale") && "bg-destructive text-destructive-foreground",
        status === "Sospesa" && "bg-yellow-500 text-white"
      )}
    >
      {status}
    </Badge>
  );
}
