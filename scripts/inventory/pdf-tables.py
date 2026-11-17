#!/usr/bin/env python3
"""Print every table of a PDF as JSON: {"pages": n, "tables": [[[cell, ...], ...], ...]}.

Used by import-docx.mjs when the product list is a PDF. Needs PyMuPDF
(pip install pymupdf). Reads the file only; writes nothing.

Spreadsheets printed to PDF often lose the horizontal cell borders of a
few rows, and table detection then merges those rows into one. So every
cell is rebuilt from the words on the page: columns come from the detected
table grid; a detected row that holds several serial numbers (the first
column) is split at each serial's text line, and every word goes to the
nearest one.
"""
import contextlib
import json
import re
import sys

try:
    import pymupdf  # PyMuPDF >= 1.24
except ImportError:  # older PyMuPDF
    try:
        import fitz as pymupdf  # type: ignore
    except ImportError:
        sys.stderr.write("PyMuPDF is required to read a PDF: pip install pymupdf\n")
        sys.exit(2)

SERIAL = re.compile(r"^[A-Za-z]{1,4}-?\d+[A-Za-z]?$")


def column_edges(tb):
    """x0 of every column (from any row where that cell exists), plus the table's right edge."""
    n = tb.col_count
    xs = [None] * n
    for row in tb.rows:
        for j, cell in enumerate(row.cells):
            if cell is not None and (xs[j] is None or cell[0] < xs[j]):
                xs[j] = cell[0]
    # a column never seen alone (always merged): between its neighbours
    for j in range(n):
        if xs[j] is None:
            xs[j] = xs[j - 1] if j else tb.bbox[0]
    return xs + [tb.bbox[2]]


def col_of(x, edges):
    for j in range(len(edges) - 1):
        if edges[j] <= x < edges[j + 1]:
            return j
    return len(edges) - 2


def table_rows(page, tb):
    edges = column_edges(tb)
    words = page.get_text("words")
    out = []
    done = set()  # serial lines already emitted: overlapping bands never repeat a row
    for row in tb.rows:
        x0, y0, x1, y1 = row.bbox
        band = [w for w in words if x0 - 1 <= (w[0] + w[2]) / 2 <= x1 + 1 and y0 - 0.5 <= (w[1] + w[3]) / 2 <= y1 + 0.5]
        serials = sorted(
            {round((w[1] + w[3]) / 2, 1) for w in band if col_of((w[0] + w[2]) / 2, edges) == 0 and SERIAL.match(w[4])}
        )
        if serials and all(y in done for y in serials):
            continue
        lines = serials if len(serials) > 1 else [None]
        cells = [[[] for _ in range(len(edges) - 1)] for _ in lines]
        for w in band:
            yc = (w[1] + w[3]) / 2
            k = 0 if lines[0] is None else min(range(len(lines)), key=lambda i: abs(lines[i] - yc))
            cells[k][col_of((w[0] + w[2]) / 2, edges)].append(w)
        for i, sub in enumerate(cells):
            line = serials[0] if lines[0] is None and serials else lines[i]
            if line is not None and line in done:
                continue
            if line is not None:
                done.add(line)
            out.append([" ".join(w[4] for w in sorted(c, key=lambda w: (round(w[1]), w[0]))) for c in sub])
    return out


def main(path):
    out = sys.stdout
    tables = []
    # PyMuPDF prints advice on stdout; keep stdout for the JSON only
    with contextlib.redirect_stdout(sys.stderr):
        doc = pymupdf.open(path)
        for page in doc:
            for tb in page.find_tables().tables:
                tables.append(table_rows(page, tb))
    json.dump({"pages": doc.page_count, "tables": tables}, out)


if __name__ == "__main__":
    main(sys.argv[1])
