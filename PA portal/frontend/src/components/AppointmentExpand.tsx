import type { AppointmentRow } from "@/lib/types";
import PriorityBadge from "./PriorityBadge";

export default function AppointmentExpand({ row }: { row: AppointmentRow }) {
  const attachments = row.attachments ?? [];
  
  // Debug logging
  if (attachments.length > 0) {
    console.log('Attachments for appointment:', row.id, attachments);
  }
  
  return (
    <td colSpan={9} className="p-0">
      <div className="px-8 py-5 border-l-4 border-brand">
        {/* Top: name + mobile */}
        <div className="grid grid-cols-2 gap-4 bg-white p-4 rounded border border-slate-200 mb-4 max-w-lg">
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Name</div>
            <div className="font-medium text-slate-800">{row.name}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Mobile</div>
            <div className="font-medium text-slate-800">{row.mobile}</div>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Left: description + audio + AI summary */}
          <div className="flex-1 min-w-0">
            {row.description && (
              <div className="mb-4">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Citizen's Description
                </div>
                <p className="text-sm text-slate-700 bg-white p-4 rounded border border-slate-200 leading-relaxed">
                  {row.description}
                </p>
              </div>
            )}
            <div className="bg-white p-4 rounded border border-slate-200">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                AI Summary
              </div>
              {row.headline && (
                <div className="font-semibold text-slate-800 mb-1">{row.headline}</div>
              )}
              {row.summary
                ? <p className="text-sm text-slate-700 leading-relaxed">{row.summary}</p>
                : <p className="text-sm text-slate-400 italic">AI summary not yet generated.</p>}
              {row.citizen_ask && (
                <div className="mt-3">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Citizen's Ask
                  </div>
                  <p className="text-sm text-slate-700">{row.citizen_ask}</p>
                </div>
              )}
              {row.key_details && row.key_details.length > 0 && (
                <div className="mt-3">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Key Details
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {row.key_details.map((d, i) => (
                      <li key={i} className="text-sm text-slate-600">{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {row.urgency && (
                <div className="mt-3"><PriorityBadge urgency={row.urgency} /></div>
              )}
            </div>
          </div>

          {/* Right: attachments */}
          <div className="w-72 flex-shrink-0">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              Attachments ({attachments.length})
            </div>
            <div className="grid grid-cols-2 gap-2">
              {attachments.length === 0 ? (
                <div className="col-span-2 h-32 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-400 text-sm">
                  No files attached
                </div>
              ) : attachments.map((a, i) => {
                if (a.type === "IMAGE") {
                  return (
                    <div key={i} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.url} alt={a.name}
                           className="w-full h-36 object-cover rounded border border-slate-200" />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center rounded">
                        <a href={a.url} target="_blank" rel="noreferrer"
                           className="text-white text-xs font-medium bg-black/50 px-2 py-1 rounded">
                          View
                        </a>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 truncate">{a.name}</p>
                    </div>
                  );
                } else if (a.type === "AUDIO") {
                  return (
                    <div key={i} className="col-span-2 bg-white p-3 rounded border border-slate-200">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        🎵 Voice Recording
                      </div>
                      <audio controls className="w-full" style={{ height: '32px' }}>
                        <source src={a.url} type="audio/webm" />
                        Your browser does not support the audio element.
                      </audio>
                    </div>
                  );
                } else {
                  return (
                    <a key={i} href={a.url} target="_blank" rel="noreferrer"
                       className="flex flex-col items-center justify-center h-36 bg-slate-50 rounded border border-slate-200 hover:bg-slate-100 transition text-center p-2">
                      <span className="text-3xl mb-2">
                        {a.type === "DOCUMENT" ? "📄" : "🎬"}
                      </span>
                      <span className="text-[10px] text-slate-500 truncate w-full text-center">{a.name}</span>
                    </a>
                  );
                }
              })}
            </div>
          </div>
        </div>
      </div>
    </td>
  );
}
