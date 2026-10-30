"""paper/make_response_docx.py — converts response_to_reviewers.md to response_to_reviewers.docx (headings, bold/italic, bullets)."""
import re
from docx import Document
from docx.shared import Pt

doc = Document()
doc.styles["Normal"].font.name = "Times New Roman"
doc.styles["Normal"].font.size = Pt(11)

def runs(par, text):
    for part in re.split(r"(\*\*[^*]+\*\*|\*[^*]+\*)", text):
        if part.startswith("**"):
            par.add_run(part[2:-2]).bold = True
        elif part.startswith("*") and len(part) > 2:
            par.add_run(part[1:-1]).italic = True
        elif part:
            par.add_run(part)

for line in open("response_to_reviewers.md", encoding="utf-8").read().splitlines():
    if not line.strip() or line.strip() == "---":
        continue
    if line.startswith("# "):
        doc.add_heading(line[2:], level=1)
    elif line.startswith("- "):
        runs(doc.add_paragraph(style="List Bullet"), line[2:])
    else:
        runs(doc.add_paragraph(), line)
doc.save("response_to_reviewers.docx")
print("saved")
