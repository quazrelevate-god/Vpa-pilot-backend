import Sidebar from "@/components/Sidebar";

// All authenticated dashboard pages share this shell. The middleware has
// already gated the routes; we just render the chrome here.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}
