#!/usr/bin/env python3
"""Write an artifact-ready copy of the game into OUT_DIR.

The claude.ai artifact host wraps the page in its own <!doctype>/<head>/<body>
skeleton, so the page file must be the document *contents* only.
Usage: python3 tools/make-artifact.py OUT_DIR
"""
import hashlib, re, shutil, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
html = (root / 'index.html').read_text()
for pat in [r'<!doctype html>\s*', r'<html[^>]*>\s*', r'</html>\s*', r'<head>\s*', r'</head>\s*', r'<body[^>]*>\s*', r'</body>\s*',
            r'<meta charset[^>]*>\s*', r'<meta name="viewport"[^>]*>\s*']:
    html = re.sub(pat, '', html, flags=re.I)
# Cache-busting: tag every local import with a hash of the sources, so a
# browser never mixes old cached modules with a new page.
h = hashlib.sha1()
for f in sorted((root / 'src').glob('*.js')) + [root / 'css' / 'style.css', root / 'index.html']:
    h.update(f.read_bytes())
v = h.hexdigest()[:10]
html = html.replace('href="css/style.css"', f'href="css/style.css?v={v}"').replace('src="src/main.js"', f'src="src/main.js?v={v}"')
(out / 'index.html').write_text(html)
for d in ['css', 'src']:
    shutil.rmtree(out / d, ignore_errors=True)
    shutil.copytree(root / d, out / d)
for f in (out / 'src').glob('*.js'):
    f.write_text(re.sub(r"(from\s+'\./[\w-]+\.js)'", rf"\1?v={v}'", f.read_text()))
print('\n'.join(str(p.relative_to(out)) for p in sorted(out.rglob('*')) if p.is_file()))
