"""
Scorecard for one or more results_*.csv produced by run_eval.py.

    python eval/score_eval.py                       # score every results_*.csv
    python eval/score_eval.py eval/results_a.csv eval/results_b.csv

Prints, per file (i.e. per model): category / department / urgency accuracy,
average human summary score, error count, latency — plus a breakdown by
language and handwritten so you can see WHERE a model wins (e.g. Tamil).
"""
import csv
import statistics
import sys
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent


def _pct(vals):
    xs = [int(v) for v in vals if str(v) in ("0", "1")]
    return round(100 * sum(xs) / len(xs), 1) if xs else None


def _load(path):
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def _slice(rows, key):
    groups = {}
    for r in rows:
        groups.setdefault((r.get(key) or "").strip(), []).append(r)
    return {g: rs for g, rs in groups.items() if g}


def report(path):
    rows = _load(path)
    n = len(rows)
    scored = [float(r["summary_score"]) for r in rows if (r.get("summary_score") or "").strip()]
    lat = [int(r["latency_ms"]) for r in rows if (r.get("latency_ms") or "").isdigit()]
    errs = sum(1 for r in rows if (r.get("error") or "").strip())

    print(f"\n== {Path(path).name}  (n={n}) ==")
    print(f"  Department accuracy : {_pct(r['department_match'] for r in rows)}%")
    print(f"  Category accuracy   : {_pct(r['category_match'] for r in rows)}%")
    print(f"  Urgency accuracy    : {_pct(r['urgency_match'] for r in rows)}%")
    print(f"  Summary score (human): {round(statistics.mean(scored), 2) if scored else '— not scored yet —'} / 5"
          f"  ({len(scored)}/{n} scored)")
    print(f"  Errors: {errs}   |   median latency: {int(statistics.median(lat)) if lat else '—'} ms")

    for key in ("language", "handwritten"):
        groups = _slice(rows, key)
        if len(groups) <= 1:
            continue
        print(f"  by {key}:")
        for g, rs in sorted(groups.items()):
            print(f"    {g:<10} dept {_pct(x['department_match'] for x in rs)}%  "
                  f"cat {_pct(x['category_match'] for x in rs)}%  "
                  f"urg {_pct(x['urgency_match'] for x in rs)}%  (n={len(rs)})")


def main(paths):
    files = paths or sorted(str(p) for p in EVAL_DIR.glob("results_*.csv"))
    if not files:
        print("No results_*.csv found. Run run_eval.py first.")
        return
    for p in files:
        report(p)


if __name__ == "__main__":
    main(sys.argv[1:])
