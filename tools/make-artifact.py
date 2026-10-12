#!/usr/bin/env python3
"""Write an artifact-ready copy of the game into OUT_DIR.

The claude.ai artifact host wraps the page in its own <!doctype>/<head>/<body>
skeleton, so the page file must be the document *contents* only.
Usage: python3 tools/make-artifact.py OUT_DIR
"""
import re, shutil, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
html = (root / 'index.html').read_text()
for pat in [r'<!doctype html>\s*', r'<html[^>]*>\s*', r'</html>\s*', r'<head>\s*', r'</head>\s*', r'<body[^>]*>\s*', r'</body>\s*',
            r'<meta charset[^>]*>\s*', r'<meta name="viewport"[^>]*>\s*']:
    html = re.sub(pat, '', html, flags=re.I)
(out / 'index.html').write_text(html)
for d in ['css', 'src']:
    shutil.rmtree(out / d, ignore_errors=True)
    shutil.copytree(root / d, out / d)
print('\n'.join(str(p.relative_to(out)) for p in sorted(out.rglob('*')) if p.is_file()))
