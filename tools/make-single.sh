#!/bin/sh
# Build one self-contained HTML file of the game (all JS and CSS inlined;
# only Three.js and the fonts still load from their CDNs). The music tracks
# are copied next to it into music/ (too big to inline); without them the
# game still runs, just without the tracks.
# Usage: sh tools/make-single.sh [OUT_FILE]   (default: dist/sideways.html)
set -e
cd "$(dirname "$0")/.."
out="${1:-dist/sideways.html}"
mkdir -p "$(dirname "$out")"
js="$(mktemp)"
npx -y esbuild@0.24.0 src/main.js --bundle --format=esm --external:three --minify --log-level=warning --outfile="$js"
python3 - "$js" "$out" <<'PY'
import sys, pathlib, re
js = pathlib.Path(sys.argv[1]).read_text().replace('</script', '<\\/script')
css = pathlib.Path('css/style.css').read_text()
html = pathlib.Path('index.html').read_text()
html = html.replace('<link rel="stylesheet" href="css/style.css">', '<style>\n' + css + '\n</style>')
html = html.replace('<script type="module" src="src/main.js"></script>', '<script type="module">\n' + js + '\n</script>')
# One file can't be installed as an app: drop the manifest and its icons.
html = re.sub(r'<link rel="manifest"[^>]*>\n|<link rel="apple-touch-icon"[^>]*>\n', '', html)
assert 'src/main.js' not in html and 'css/style.css' not in html
pathlib.Path(sys.argv[2]).write_text(html)
print(sys.argv[2], len(html) // 1024, 'KB')
PY
rm -f "$js"
rm -rf "$(dirname "$out")/music" && cp -r music "$(dirname "$out")/music"
