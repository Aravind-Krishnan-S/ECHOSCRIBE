"""Flatten main.tex into one self-contained file: inlines every \\input and embeds refs.bib with filecontents*.
Usage: python build_single.py   (run in paper/)"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
rd = lambda f: (HERE / f).read_text(encoding='utf-8')

main = rd('main.tex')


def inline(m):
    name = m.group(1)
    if not name.endswith('.tex'):
        name += '.tex'
    return rd(name).rstrip('\n')


body = re.sub(r'\\input\{([^}]+)\}', inline, main)
bib = rd('refs.bib').rstrip('\n')
assert '\\end{filecontents' not in bib
single = (
    "% EchoScribe: single-file build. Needs only the figures/ folder next to it; the bibliography is\n"
    "% embedded below (filecontents*) and written to refs.bib on the first run. The results macros come from\n"
    "% eval/make_macros.py and are inlined in the preamble.\n"
    "\\begin{filecontents*}{refs.bib}\n" + bib + "\n\\end{filecontents*}\n" + body
)
(HERE / 'EchoScribe_paper_single.tex').write_text(single, encoding='utf-8')
print('single file:', len(single), 'bytes; remaining \\input:', len(re.findall(r'\\input\{', single)))
