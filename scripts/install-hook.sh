#!/bin/sh
# Install GutterNotes pre-commit safety hook
# Usage: ./install-hook.sh [repo-path]

REPO="${1:-.}"
HOOKS_DIR="$REPO/.git/hooks"
HOOK_FILE="$HOOKS_DIR/pre-commit"

SNIPPET='
# BEGIN GUTTERNOTES
# Safety net: prevent accidental note markers from being committed
if git diff --cached --diff-filter=ACM -U0 | grep -q "§n\|GUTTERNOTE:"; then
  echo "GutterNotes: Found note markers in staged changes."
  echo "Please remove them before committing."
  exit 1
fi
# END GUTTERNOTES'

if [ ! -d "$REPO/.git" ]; then
  echo "Error: $REPO is not a git repository"
  exit 1
fi

mkdir -p "$HOOKS_DIR"

if [ -f "$HOOK_FILE" ] && grep -q "BEGIN GUTTERNOTES" "$HOOK_FILE"; then
  echo "GutterNotes hook already installed in $HOOK_FILE"
  exit 0
fi

if [ -f "$HOOK_FILE" ]; then
  printf '%s\n' "$SNIPPET" >> "$HOOK_FILE"
else
  printf '#!/bin/sh\n%s\n' "$SNIPPET" > "$HOOK_FILE"
fi

chmod +x "$HOOK_FILE"
echo "GutterNotes pre-commit hook installed at $HOOK_FILE"
