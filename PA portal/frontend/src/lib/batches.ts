/**
 * Friendly names for AI-upload batches.
 *
 * A batch_id is a uuid hex — useless to a human. The portal labels batches
 * `Batch_YYYY_MM_DD_NNN`, numbered per calendar day in the order they were
 * created. Both AI Uploads (the batch list) and Petition Review (the
 * "showing one batch" banner) must produce the SAME label for the same batch,
 * so the numbering lives here rather than being copied into each page.
 *
 * Both callers derive this from the full, unfiltered /api/ai-uploads list, so
 * the per-day sequence agrees on both screens.
 */
export interface BatchRowLike {
  batch_id?: string | null;
  created_at?: string | null;
}

/** Earliest created_at per batch — a batch is dated by its first file. */
function firstCreatedByBatch(rows: BatchRowLike[]): Map<string, string> {
  const created = new Map<string, string>();
  for (const r of rows) {
    const id = r.batch_id;
    if (!id) continue;
    const at = r.created_at ?? "";
    const cur = created.get(id);
    if (cur === undefined || (at && (!cur || at < cur))) created.set(id, at);
  }
  return created;
}

/** Map of batch_id -> "Batch_2026_07_19_001". */
export function batchNames(rows: BatchRowLike[]): Record<string, string> {
  const created = firstCreatedByBatch(rows);
  const asc = [...created.entries()].sort((a, b) => (a[1] || "").localeCompare(b[1] || ""));
  const perDay: Record<string, number> = {};
  const nameById: Record<string, string> = {};
  for (const [id, at] of asc) {
    const day = (at || "").slice(0, 10) || "batch";
    perDay[day] = (perDay[day] ?? 0) + 1;
    nameById[id] = `Batch_${day.replace(/-/g, "_")}_${String(perDay[day]).padStart(3, "0")}`;
  }
  return nameById;
}

/** One batch's name, falling back to a short id when it can't be derived. */
export function batchName(rows: BatchRowLike[], batchId: string): string {
  return batchNames(rows)[batchId] ?? batchId.slice(0, 8);
}
