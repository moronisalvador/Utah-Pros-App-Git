#!/bin/sh
# Shim. Xcode Cloud looks for ci_scripts either beside the .xcodeproj (here) or
# at the repository root, depending on how the workflow resolves its primary
# repository. A CI script that is silently never found is worse than a four-line
# forwarder, so both locations exist and only one file holds the logic.
set -e
REPO="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../../.." && pwd)}"
exec sh "$REPO/ci_scripts/ci_post_clone.sh"
