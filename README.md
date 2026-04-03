# GutterNotes

**Local-only code annotations that survive git merges, rebases, and branch switches.**

## The Problem

You're reading code and you have thoughts — "this should use RS256", "ask security team about this", "potential race condition here". You want to pin these thoughts to specific lines of code.

Your options today all suck:

- **Code comments** — get committed, clutter PRs, pollute the codebase with your personal stream of consciousness
- **TODO comments** — same problem, plus they rot. Nobody cleans them up
- **Bookmarks extensions** — store line numbers. Rebase? Merge? Line numbers shift. Your bookmarks point to the wrong lines
- **External notes (Notion, markdown files)** — "line 42 of auth.ts" is meaningless after the next commit moves it to line 67
- **Git stash / local branches** — not designed for annotations. Merge conflicts everywhere

The fundamental tension: **inline notes move with code but get committed. External notes never get committed but lose their position.**

## The Solution

GutterNotes stores annotations externally (never in your repo) but anchors them using `git blame` — the same mechanism git uses to track where every line came from. When lines move during a rebase or merge, blame still knows their origin. Your notes follow automatically.

```
Your working tree          GutterNotes store (~/.gutternotes/)
┌─────────────────┐        ┌──────────────────────────────┐
│ const token =   │◄──────►│ anchor: (commit a1b2, L38)   │
│   jwt.sign(...) │        │ note: "Should use RS256"     │
│                 │        │ category: bug                │
└─────────────────┘        └──────────────────────────────┘
         │                              │
    git rebase                    blame resolves
    line moves to L52              anchor → L52
         │                              │
         ▼                              ▼
     Still works.                  Note follows.
```

Notes are **never committed, never pushed, never visible to your team**. They exist only on your machine.

## Install

```bash
# VS Code
code --install-extension gutternotes-0.2.0.vsix

# Cursor
cursor --install-extension gutternotes-0.2.0.vsix
```

Or build from source:

```bash
git clone https://github.com/vaddisrinivas/gutternotes.git
cd gutternotes
npm install
npm run build
npx vsce package --allow-missing-repository
```

## Usage

### Add a note

**`Cmd+Alt+N`** (or right-click → "Add Note")

Pick a category, type your note. Done.

### Categories

Each category gets its own colored gutter icon:

| Category | Color | Use for |
|----------|-------|---------|
| `note` | Blue | General annotations |
| `todo` | Green | Things to come back to |
| `question` | Purple | Things to ask someone about |
| `bug` | Red | Suspected issues |
| `important` | Orange | Don't forget this |

### Navigate

| Shortcut | Action |
|----------|--------|
| `Cmd+Alt+]` | Jump to next note in file |
| `Cmd+Alt+[` | Jump to previous note in file |
| `Cmd+Alt+F` | Fuzzy search across all notes |
| Hover a noted line | See full note, edit/delete links |
| Click in sidebar | Jump to any note |

### Other commands (Cmd+Shift+P)

- **GutterNotes: Export Notes** — save all notes to a JSON file for backup
- **GutterNotes: Import Notes** — restore from a previous export (merges, deduplicates)
- **GutterNotes: Resolve Orphaned Notes** — re-anchor or delete notes whose lines were removed
- **GutterNotes: Refresh Notes** — force re-resolve all anchors (after a big rebase)
- **GutterNotes: Install Pre-Commit Hook** — safety net that blocks accidental note markers

## How It Works

### Blame-based anchoring

When you add a note on a line, GutterNotes runs `git blame` to find that line's **origin**: the commit, file, and line number where it was first introduced. This triple `(commit, file, line)` is a stable identity — it doesn't change when the line moves around.

On every file open/save, GutterNotes re-runs blame and matches stored anchors to current line positions:

1. **Exact match** — same `(commit, file, line)` still exists → note stays
2. **Content match** — line was re-committed but content is identical → note follows
3. **Orphaned** — line was deleted or completely rewritten → note marked as orphaned

### What survives what

| Git operation | Notes survive? | How |
|---------------|---------------|-----|
| `git merge` | Yes | Blame tracks line origins through merges |
| `git rebase` | Yes | Blame resolves to new line positions |
| `git cherry-pick` | Yes | Content hash matches the picked line |
| Branch switch | Yes | Blame re-resolves on file open |
| File rename | Yes | Blame with `-C` tracks renames |
| Line deleted | Orphaned | Note surfaces for re-anchor or deletion |
| Line rewritten | Content match or orphaned | Depends on how much changed |

### Storage

Notes live at `~/.gutternotes/<repo-hash>/notes.json`. Completely outside your repo — nothing to `.gitignore`, zero risk of committing.

### Uncommitted lines

Notes on lines you haven't committed yet use a temporary anchor `(lineNumber, contentHash)`. Once you commit, the next file save auto-upgrades the anchor to a full blame-based one.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `gutternotes.inlinePreview` | `true` | Show inline text after annotated lines |
| `gutternotes.maxInlineLength` | `60` | Max characters in inline preview |
| `gutternotes.orphanWarning` | `true` | Show warning decorations for orphaned notes |

## Development

```bash
npm run watch    # auto-rebuild on changes
# Press F5 in VS Code to launch Extension Development Host
```

## License

MIT
