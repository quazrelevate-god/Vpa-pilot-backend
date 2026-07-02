"""
Petition-summariser evaluator — run test images through a model and auto-score
the routing (category / department / urgency) against gold labels.

Run from the backend/ directory:

    python eval/run_eval.py --model gemini-2.5-flash
    python eval/run_eval.py --model gemini-2.5-pro
    python eval/run_eval.py --model gemini-3.1-pro --cases eval/cases.csv

Reads eval/cases.csv + the image files in eval/cases/. For each case it calls
the real summariser on the chosen model, compares category/department/urgency to
the gold labels, and writes eval/results_<model>_<timestamp>.csv containing the
generated summary (EN + Tamil) with a BLANK `summary_score` column.

You then fill `summary_score` (1-5) by hand, and run:

    python eval/score_eval.py

to get the scorecard. Uses the real Gemini API (needs GEMINI_API_KEY in .env).
"""
import argparse
import csv
import mimetypes
import sys
import time
from datetime import datetime
from pathlib import Path

# Make `import src.*` work when run as `python eval/run_eval.py` from backend/.
_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND))

EVAL_DIR = _BACKEND / "eval"
CASES_DIR = EVAL_DIR / "cases"

# Approximate published prices (USD per 1M tokens), July 2026 — input, output.
# Only used for a rough ₹/petition estimate in the scorecard; refine as needed.
PRICES = {
    "gemini-2.5-flash":      (0.30, 2.50),
    "gemini-2.5-pro":        (1.25, 10.00),
    "gemini-3-flash":        (0.50, 4.00),
    "gemini-3.5-flash":      (1.50, 9.00),
    "gemini-3.1-pro":        (2.00, 12.00),
    "gemini-3.1-flash-lite": (0.10, 0.40),
    "gemini-2.0-flash":      (0.10, 0.40),
}


def _score(gold: str, pred: str, errored: bool):
    if errored:
        return ""
    return 1 if (gold or "").strip().lower() == (pred or "").strip().lower() else 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="e.g. gemini-2.5-flash, gemini-2.5-pro, gemini-3.1-pro")
    ap.add_argument("--cases", default=str(EVAL_DIR / "cases.csv"))
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    from src.core.config import settings
    from src.services.summarisation import GrievanceSummarisationService

    # No cross-model fallback — we want to measure THIS model, not a fallback.
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
        print(f"No cases found in {args.cases}. Add rows + images first.")
        return

    results = []
    for r in cases:
        cid = r["id"].strip()
        files = [x.strip() for x in (r.get("files") or "").split(";") if x.strip()]
        attachments = []
        load_err = ""
        for fn in files:
            p = CASES_DIR / fn
            if not p.exists():
                load_err = f"missing file: {fn}"
                break
            mime = mimetypes.guess_type(fn)[0] or "image/jpeg"
            attachments.append((p.read_bytes(), mime, fn))

        pred_cat = pred_dept = pred_urg = headline = summary_en = summary_ta = ""
        err = load_err
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

        gcat, gdept, gurg = (r.get("gold_category") or "").strip().lower(), \
            (r.get("gold_department") or "").strip().lower(), (r.get("gold_urgency") or "").strip().lower()
        errored = bool(err)
        row = {
            "id": cid, "language": r.get("language", ""), "handwritten": r.get("handwritten", ""),
            "gold_category": gcat, "pred_category": pred_cat, "category_match": _score(gcat, pred_cat, errored),
            "gold_department": gdept, "pred_department": pred_dept, "department_match": _score(gdept, pred_dept, errored),
            "gold_urgency": gurg, "pred_urgency": pred_urg, "urgency_match": _score(gurg, pred_urg, errored),
            "headline": headline, "summary_en": summary_en, "summary_ta": summary_ta,
            "summary_score": "", "summary_notes": "",   # <-- YOU fill summary_score 1-5
            "latency_ms": latency_ms, "error": err,
        }
        results.append(row)
        mark = lambda m: ("·" if m == "" else ("✓" if m == 1 else "✗"))
        print(f"[{cid}] dept {mark(row['department_match'])} ({pred_dept or '—'})  "
              f"cat {mark(row['category_match'])} ({pred_cat or '—'})  "
              f"urg {mark(row['urgency_match'])}  {latency_ms}ms" + (f"  ERROR: {err}" if err else ""))

    out = args.out or str(EVAL_DIR / f"results_{args.model.replace('.', '_')}_{datetime.now():%Y%m%d_%H%M}.csv")
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(results[0].keys()))
        w.writeheader()
        w.writerows(results)

    ok = sum(1 for r in results if not r["error"])
    print(f"\nRan {len(results)} cases ({ok} ok, {len(results)-ok} errored) on {args.model}")
    print(f"Wrote {out}")
    print("Next: open it, fill the `summary_score` column (1-5), then run: python eval/score_eval.py")


if __name__ == "__main__":
    main()
