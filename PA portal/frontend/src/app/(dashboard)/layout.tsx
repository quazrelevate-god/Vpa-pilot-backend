import Sidebar from "@/components/Sidebar";
import DashboardProviders from "@/components/DashboardProviders";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProviders>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
      </div>
    </DashboardProviders>
  );
}
