export default function TopBar({ rightSlot }: { rightSlot?: React.ReactNode }) {
  return (
    <header className="h-16 bg-white border-b flex items-center px-6 gap-4 flex-shrink-0 justify-between">
      <div className="flex items-center gap-4">
        <div className="text-xs text-slate-500 font-medium tracking-wide">
          Government of Tamil Nadu
        </div>
        <div className="h-5 w-px bg-slate-200" />
        <div className="text-sm font-bold text-slate-900">
          Petition Appointment Management System
        </div>
      </div>
      <div className="text-xs text-slate-400">{rightSlot}</div>
    </header>
  );
}
