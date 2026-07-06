import { Toaster } from "@/components/ui/sonner";
import { DeptLangProvider } from "./_lib/i18n";

export default function DeptLayout({ children }: { children: React.ReactNode }) {
  return (
    <DeptLangProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        {children}
        <Toaster />
      </div>
    </DeptLangProvider>
  );
}
