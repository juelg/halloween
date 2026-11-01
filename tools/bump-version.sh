#!/bin/sh
# Stamp every local JS/CSS reference with ?v=<version> so browsers fetch fresh
# files after each deploy (GitHub Pages lets them cache for 10 minutes).
# Run before committing a change that should go live: tools/bump-version.sh
set -e
cd "$(dirname "$0")/.."
V=$(date +%Y%m%d%H%M%S)
# relative module imports: './x.js', "../x.js", optionally already versioned
perl -pi -e "s#((?:'|\")\.{1,2}/[\w./-]+\.js)(\?v=\w+)?(?=['\"])#\$1?v=$V#g" js/*.js
# script/link tags in the pages
perl -pi -e "s#((?:src|href)=\"(?:js|css|vendor)/[\w./-]+\.(?:js|css))(\?v=\w+)?\"#\$1?v=$V\"#g" *.html
echo "version $V"
