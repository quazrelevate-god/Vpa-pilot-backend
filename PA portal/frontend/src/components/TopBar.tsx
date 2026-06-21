import { ShieldCheck } from "lucide-react";

export default function TopBar({ rightSlot }: { rightSlot?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 h-16 flex-shrink-0 border-b border-border bg-card/80 backdrop-blur-md">
      <div className="flex h-full items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/5 text-primary ring-1 ring-primary/10">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Staff Portal
            </div>
            <div className="text-sm font-bold tracking-tight text-foreground">
              Petition &amp; Appointment Management
            </div>
          </div>
        </div>
        {rightSlot != null && (
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {rightSlot}
          </div>
        )}
      </div>
    </header>
  );
}
