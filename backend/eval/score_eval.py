"""
Scorecard for results_*.csv from run_eval.py.

    python eval/score_eval.py                # every results_*.csv in eval/
    python eval/score_eval.py results_a.csv results_b.csv

Per file (i.e. per model): category / department accuracy (auto),
urgency / summary accuracy (from human scoring), median latency, errors.
Also sliced by language + handwritten so you can see WHERE each model wins.
"""
import csv
import statistics
import sys
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent


def _pct(values, valid=("0", "1")):
    xs = [int(v) for v in values if str(v).strip() in valid]
    return f"{round(100 * sum(xs) / len(xs), 1)}%" if xs else "—"


def _n_scored(values):
    return sum(1 for v in values if str(v).strip() in ("0", "1"))


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
    lat = [int(r["latency_ms"]) for r in rows if (r.get("latency_ms") or "").isdigit()]
    errs = sum(1 for r in rows if (r.get("error") or "").strip())

    dept_acc = _pct(r.get("department_match") for r in rows)
    cat_acc  = _pct(r.get("category_match")   for r in rows)
    urg_acc  = _pct(r.get("urgency_right")    for r in rows)
    sum_acc  = _pct(r.get("summary_right")    for r in rows)
    urg_n    = _n_scored(r.get("urgency_right") for r in rows)
    sum_n    = _n_scored(r.get("summary_right") for r in rows)

    print(f"\n== {Path(path).name}  (n={n}) ==")
    print(f"  Department (auto)   : {dept_acc}")
    print(f"  Category   (auto)   : {cat_acc}")
    print(f"  Urgency  (human)    : {urg_acc}   [{urg_n}/{n} scored]")
    print(f"  Summary  (human)    : {sum_acc}   [{sum_n}/{n} scored]")
    print(f"  Errors: {errs}   |   median latency: {int(statistics.median(lat)) if lat else '—'} ms")

    for key in ("language", "handwritten"):
        groups = _slice(rows, key)
        if len(groups) <= 1:
            continue
        print(f"  by {key}:")
        for g, rs in sorted(groups.items()):
            print(f"    {g:<10} dept {_pct(x.get('department_match') for x in rs)}  "
                  f"cat {_pct(x.get('category_match') for x in rs)}  "
                  f"urg {_pct(x.get('urgency_right') for x in rs)}  "
                  f"sum {_pct(x.get('summary_right') for x in rs)}  (n={len(rs)})")


def main(paths):
    files = paths or sorted(str(p) for p in EVAL_DIR.glob("results_*.csv"))
    if not files:
        print("No results_*.csv found. Run run_eval.py first.")
        return
    for p in files:
        report(p)


if __name__ == "__main__":
    main(sys.argv[1:])
