import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { type OverallStatus } from "@/types";

export function StatusBadge({ status, isSuspended, hasMaterialShortage }: { status: OverallStatus, isSuspended?: boolean, hasMaterialShortage?: boolean }) {
  return (
    <Badge
      className={cn(
        "py-1 px-2 text-[10px] font-black tracking-widest uppercase rounded-lg border-none shadow-sm",
        status === "DA_INIZIARE" && "bg-slate-400 text-white",
        status === "IN_PREPARAZIONE" && "bg-amber-500 text-white",
        status === "PRONTO_PROD" && "bg-emerald-500 text-white",
        status === "IN_PRODUZIONE" && "bg-blue-600 text-white animate-pulse",
        status === "FINE_PRODUZIONE" && "bg-purple-600 text-white",
        status === "QLTY_PACK" && "bg-pink-600 text-white",
        status === "CHIUSO" && "bg-slate-950 text-white"
      )}
    >
      {status.replace('_', ' ')}
    </Badge>
  );
}
