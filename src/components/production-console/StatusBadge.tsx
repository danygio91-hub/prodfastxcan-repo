
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { type OverallStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: OverallStatus }) {
  return (
    <Badge
      className={cn(
        "py-1 px-3 text-xs font-semibold tracking-wide",
        status === "Da Iniziare" && "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        status === "In Lavorazione" && "bg-accent text-accent-foreground hover:bg-accent/90 animate-pulse",
        status === "Completata" && "bg-primary text-primary-foreground hover:bg-primary/90",
        status === "Problema" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        status === "Sospesa" && "bg-yellow-500 text-yellow-50"
      )}
    >
      {status}
    </Badge>
  );
}
