"""
Petition-summariser evaluator — run test images through a model, auto-score
CATEGORY + DEPARTMENT against gold labels, and emit a results CSV with the
predicted urgency + generated summary so a human can mark them right/wrong.

Run from backend/:

    python eval/run_eval.py --model gemini-2.5-flash
    python eval/run_eval.py --model gemini-2.5-pro
    python eval/run_eval.py --model gemini-3-flash
    python eval/run_eval.py --model gemini-3.5-flash
    python eval/run_eval.py --model gemini-3.1-pro

Reads eval/cases.csv + eval/cases/. Writes eval/results_<model>_<ts>.csv with:
    category_match, department_match  → auto (0/1)
    urgency_right, summary_right       → BLANK — human fills 0/1
    summary_notes                      → free text (optional)

Then either open eval/scorer.html in a browser to score interactively (drag
the results CSV in), or edit the CSV directly. Finally:

    python eval/score_eval.py

for the scorecard. Uses the real Gemini API (needs GEMINI_API_KEY in .env).
"""
import argparse
import csv
import mimetypes
import sys
import time
from datetime import datetime
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND))

# Windows consoles default to cp1252 and choke on ✓/✗ — force UTF-8 output.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

EVAL_DIR = _BACKEND / "eval"
CASES_DIR = EVAL_DIR / "cases"

# Rough published prices (USD per 1M tokens), July 2026 — input, output.
# Used for a ballpark ₹/petition estimate; verify against Google's page.
PRICES = {
    "gemini-2.5-flash":      (0.30,  2.50),
    "gemini-2.5-pro":        (1.25, 10.00),
    "gemini-3-flash":        (0.50,  4.00),
    "gemini-3.5-flash":      (1.50,  9.00),
    "gemini-3.1-pro":        (2.00, 12.00),
    "gemini-3.1-flash-lite": (0.10,  0.40),
    "gemini-2.0-flash":      (0.10,  0.40),
}


def _match(gold: str, pred: str, errored: bool):
    if errored:
        return ""
    return 1 if (gold or "").strip().lower() == (pred or "").strip().lower() else 0


def _usage(response) -> tuple[int, int]:
    """Best-effort token counts from the Gemini SDK response, if available."""
    try:
        u = getattr(response, "usage_metadata", None)
        if not u:
            return 0, 0
        return int(getattr(u, "prompt_token_count", 0) or 0), \
               int(getattr(u, "candidates_token_count", 0) or 0)
    except Exception:
        return 0, 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True,
                    help=f"e.g. {', '.join(sorted(PRICES))}")
    ap.add_argument("--cases", default=str(EVAL_DIR / "cases.csv"))
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    from src.core.config import settings
    from src.services.summarisation import GrievanceSummarisationService
    from google.genai import types  # noqa

    # No cross-model fallback — we want to measure THIS model, not another.
    svc = GrievanceSummarisationService(
        api_key=settings.GEMINI_API_KEY,
        model_name=args.model,
        fallback_model=args.model,
        fallback_model2=args.model,
        service_tier=settings.GEMINI_SERVICE_TIER,
    )

    with open(args.cases, encoding="utf-8-sig") as f:
        cases = [r for r in csv.DictReader(f) if (r.get("id") or "").strip()]
    if not cases:
        print(f"No cases in {args.cases}. Add rows + images to eval/cases/ first.")
        return

    results = []
    for r in cases:
        cid = r["id"].strip()
        files = [x.strip() for x in (r.get("files") or "").split(";") if x.strip()]
        attachments = []
        err = ""
        for fn in files:
            p = CASES_DIR / fn
            if not p.exists():
                err = f"missing file: {fn}"
                break
            mime = mimetypes.guess_type(fn)[0] or "image/jpeg"
            attachments.append((p.read_bytes(), mime, fn))

        pred_cat = pred_dept = pred_urg = headline = summary_en = summary_ta = ""
        tokens_in = tokens_out = 0
        t0 = time.monotonic()
        if not err and attachments:
            try:
                s = svc.summarise_manual(citizen_name="", constituency="", attachments=attachments)
                pred_cat, pred_dept, pred_urg = s.category.value, s.department.value, s.urgency.value
                headline, summary_en, summary_ta = s.headline, s.summary, s.summary_ta
            except Exception as e:
                err = str(e)[:250]
        elif not err:
            err = "no image files"
        latency_ms = int((time.monotonic() - t0) * 1000)
        errored = bool(err)

        gcat = (r.get("gold_category") or "").strip().lower()
        gdept = (r.get("gold_department") or "").strip().lower()
        row = {
            "id": cid,
            "language": r.get("language", ""),
            "handwritten": r.get("handwritten", ""),
            "files": r.get("files", ""),
            "gold_category":   gcat,
            "pred_category":   pred_cat,
            "category_match":  _match(gcat, pred_cat, errored),
            "gold_department": gdept,
            "pred_department": pred_dept,
            "department_match": _match(gdept, pred_dept, errored),
            "pred_urgency":    pred_urg,
            "urgency_right":   "",   # <-- HUMAN fills 1 (right) or 0 (wrong)
            "headline":        headline,
            "summary_en":      summary_en,
            "summary_ta":      summary_ta,
            "summary_right":   "",   # <-- HUMAN fills 1 (right) or 0 (wrong)
            "summary_notes":   "",   # <-- HUMAN free text (optional)
            "latency_ms":      latency_ms,
            "tokens_in":       tokens_in,
            "tokens_out":      tokens_out,
            "error":           err,
        }
        results.append(row)
        mark = lambda m: ("·" if m == "" else ("✓" if m == 1 else "✗"))
        print(f"[{cid}] dept {mark(row['department_match'])} ({pred_dept or '—'})  "
              f"cat {mark(row['category_match'])} ({pred_cat or '—'})  "
              f"urg? ({pred_urg or '—'})  {latency_ms}ms"
              + (f"  ERROR: {err}" if err else ""))

    out = args.out or str(EVAL_DIR / f"results_{args.model.replace('.', '_')}_{datetime.now():%Y%m%d_%H%M}.csv")
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(results[0].keys()))
        w.writeheader()
        w.writerows(results)

    ok = sum(1 for r in results if not r["error"])
    print(f"\nRan {len(results)} cases ({ok} ok, {len(results)-ok} errored) on {args.model}")
    print(f"Wrote {out}")
    print("Next: open eval/scorer.html in a browser and drop this file in — click ✓/✗")
    print("      for urgency + summary per row. Download the updated CSV, then run:")
    print("          python eval/score_eval.py")


if __name__ == "__main__":
    main()
