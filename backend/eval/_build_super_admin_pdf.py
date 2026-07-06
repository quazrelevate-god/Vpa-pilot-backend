"""
Build docs/super-admin-brainstorm.pdf from the .md sibling.

Not runtime code — a one-off doc build helper. Keeps the markdown as the
source of truth and produces a readable PDF for sharing with stakeholders.

Run:
    ./venv/Scripts/python.exe eval/_build_migration_pdf.py
"""
from __future__ import annotations

import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs" / "super-admin-brainstorm.md"
OUT = ROOT / "docs" / "super-admin-brainstorm.pdf"


# ── Styles ─────────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

STYLE_TITLE = ParagraphStyle(
    "PlanTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=22, leading=27, spaceAfter=6, textColor=colors.HexColor("#0f172a"),
)
STYLE_SUBTITLE = ParagraphStyle(
    "PlanSubtitle", parent=styles["Normal"], fontName="Helvetica",
    fontSize=10, leading=14, textColor=colors.HexColor("#64748b"), spaceAfter=18,
)
STYLE_H1 = ParagraphStyle(
    "H1", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=16, leading=20, spaceBefore=22, spaceAfter=8,
    textColor=colors.HexColor("#0f172a"),
)
STYLE_H2 = ParagraphStyle(
    "H2", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=13, leading=17, spaceBefore=16, spaceAfter=6,
    textColor=colors.HexColor("#1e293b"),
)
STYLE_H3 = ParagraphStyle(
    "H3", parent=styles["Heading3"], fontName="Helvetica-Bold",
    fontSize=11, leading=14, spaceBefore=10, spaceAfter=4,
    textColor=colors.HexColor("#334155"),
)
STYLE_BODY = ParagraphStyle(
    "Body", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=10, leading=14.5, spaceAfter=6, textColor=colors.HexColor("#111827"),
)
STYLE_BULLET = ParagraphStyle(
    "Bullet", parent=STYLE_BODY, leftIndent=16, bulletIndent=4, spaceAfter=3,
)
STYLE_CODE = ParagraphStyle(
    "Code", parent=styles["Code"], fontName="Courier", fontSize=9, leading=12,
    leftIndent=10, rightIndent=10, spaceBefore=6, spaceAfter=10,
    backColor=colors.HexColor("#f1f5f9"), borderColor=colors.HexColor("#cbd5e1"),
    borderPadding=(6, 8, 6, 8), borderWidth=0.5,
)


# ── Inline markdown helpers ────────────────────────────────────────────────────

def inline(text: str) -> str:
    """Convert lightweight markdown inline syntax to reportlab-friendly HTML."""
    # Escape angle brackets first so raw HTML in the source doesn't leak
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    # Bold
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    # Inline code
    text = re.sub(r"`([^`]+?)`", r'<font face="Courier" size="9.5">\1</font>', text)
    # Italic (underscore-based only, so we don't mangle URLs with * in them)
    text = re.sub(r"(?<!\w)_(.+?)_(?!\w)", r"<i>\1</i>", text)
    # Basic markdown links [label](url)
    text = re.sub(r"\[(.+?)\]\((.+?)\)", r'<link href="\2" color="#2563eb"><u>\1</u></link>', text)
    return text


# ── Table cell paragraph (smaller, tighter) ────────────────────────────────────
STYLE_TABLE_CELL = ParagraphStyle(
    "TCell", parent=STYLE_BODY, fontSize=9, leading=12, spaceAfter=0,
)
STYLE_TABLE_HEADER = ParagraphStyle(
    "THead", parent=STYLE_BODY, fontSize=9.5, leading=12,
    textColor=colors.white, fontName="Helvetica-Bold", spaceAfter=0,
)


def render_table(rows: list[list[str]]):
    """Render a markdown table into a reportlab Table with clean styling."""
    if not rows:
        return None
    header, *body = rows
    data = [[Paragraph(inline(c), STYLE_TABLE_HEADER) for c in header]]
    for row in body:
        data.append([Paragraph(inline(c), STYLE_TABLE_CELL) for c in row])

    tbl = Table(data, colWidths=None, hAlign="LEFT", repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#f8fafc")]),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return tbl


# ── Markdown → flowables parser ────────────────────────────────────────────────

def split_cells(row: str) -> list[str]:
    return [c.strip() for c in row.strip().strip("|").split("|")]


def parse(md: str) -> list:
    """Convert the markdown source into a list of reportlab flowables."""
    flow: list = []
    lines = md.splitlines()
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]
        stripped = line.strip()

        # Blank line
        if not stripped:
            i += 1
            continue

        # Fenced code block
        if stripped.startswith("```"):
            j = i + 1
            code_lines = []
            while j < n and not lines[j].strip().startswith("```"):
                code_lines.append(lines[j])
                j += 1
            code_html = ("<br/>".join(
                l.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                 .replace(" ", "&nbsp;") or "&nbsp;"
                for l in code_lines
            ))
            flow.append(Paragraph(code_html, STYLE_CODE))
            i = j + 1
            continue

        # Horizontal rule
        if stripped == "---":
            flow.append(Spacer(1, 4))
            flow.append(HRFlowable(width="100%", thickness=0.7,
                                   color=colors.HexColor("#cbd5e1"),
                                   spaceBefore=2, spaceAfter=10))
            i += 1
            continue

        # Headings
        if stripped.startswith("# "):
            flow.append(Paragraph(inline(stripped[2:]), STYLE_TITLE))
            i += 1
            continue
        if stripped.startswith("## "):
            flow.append(Paragraph(inline(stripped[3:]), STYLE_H1))
            i += 1
            continue
        if stripped.startswith("### "):
            flow.append(Paragraph(inline(stripped[4:]), STYLE_H2))
            i += 1
            continue
        if stripped.startswith("#### "):
            flow.append(Paragraph(inline(stripped[5:]), STYLE_H3))
            i += 1
            continue

        # Tables — detected by a header row + separator row
        if stripped.startswith("|") and i + 1 < n and re.match(
            r"^\|\s*:?-{2,}", lines[i + 1].strip()
        ):
            rows = [split_cells(stripped)]
            j = i + 2
            while j < n and lines[j].strip().startswith("|"):
                rows.append(split_cells(lines[j].strip()))
                j += 1
            tbl = render_table(rows)
            if tbl is not None:
                flow.append(Spacer(1, 4))
                flow.append(tbl)
                flow.append(Spacer(1, 10))
            i = j
            continue

        # Bulleted list
        if stripped.startswith(("- ", "* ")):
            item_html = inline(stripped[2:])
            flow.append(Paragraph(f"&bull;&nbsp;&nbsp;{item_html}", STYLE_BULLET))
            i += 1
            continue

        # Numbered list
        m = re.match(r"^(\d+)\.\s+(.+)$", stripped)
        if m:
            num, body = m.groups()
            flow.append(Paragraph(f"{num}.&nbsp;&nbsp;{inline(body)}", STYLE_BULLET))
            i += 1
            continue

        # Regular paragraph — coalesce until blank line
        buf = [stripped]
        j = i + 1
        while j < n and lines[j].strip() and not lines[j].lstrip().startswith(
            ("#", "-", "*", "|", "```", ">", "1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9.")
        ):
            buf.append(lines[j].strip())
            j += 1
        para = " ".join(buf)
        flow.append(Paragraph(inline(para), STYLE_BODY))
        i = j

    return flow


# ── Page frame ────────────────────────────────────────────────────────────────

def add_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#94a3b8"))
    text = (
        f"Super admin brainstorm  ·  PA Office backend  ·  "
        f"page {doc.page}"
    )
    canvas.drawCentredString(A4[0] / 2, 12 * mm, text)
    canvas.restoreState()


def main() -> None:
    md = SRC.read_text(encoding="utf-8")
    flowables = parse(md)

    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=18 * mm, bottomMargin=20 * mm,
        title="Super admin brainstorm",
        author="PA Office backend",
    )
    doc.build(flowables, onFirstPage=add_footer, onLaterPages=add_footer)
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
