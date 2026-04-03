import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import { CodeNote, NoteAnchor, RepoNotesStore, NoteCategory, NOTE_CATEGORIES, CATEGORY_COLORS } from './types';
import { blameFile, contentHash } from './anchor';
import * as storage from './storage';

export interface CommandDeps {
  getStore: () => RepoNotesStore;
  setStore: (store: RepoNotesStore) => void;
  repoPath: string;
  refreshEditor: (editor?: vscode.TextEditor) => Promise<void>;
  refreshTree: () => void;
  updateStatusBar: () => void;
}

function getRelativePath(repoPath: string, absolutePath: string): string {
  return path.relative(repoPath, absolutePath).replace(/\\/g, '/');
}

export function registerCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gutternotes.addNote', () => addNote(deps)),
    vscode.commands.registerCommand('gutternotes.editNote', (noteId?: string) =>
      editNote(deps, noteId)
    ),
    vscode.commands.registerCommand('gutternotes.deleteNote', (noteId?: string) =>
      deleteNote(deps, noteId)
    ),
    vscode.commands.registerCommand('gutternotes.navigateToNote', (noteId?: string) =>
      navigateToNote(deps, noteId)
    ),
    vscode.commands.registerCommand('gutternotes.nextNote', () => jumpNote(deps, 'next')),
    vscode.commands.registerCommand('gutternotes.prevNote', () => jumpNote(deps, 'prev')),
    vscode.commands.registerCommand('gutternotes.searchNotes', () => searchNotes(deps)),
    vscode.commands.registerCommand('gutternotes.refreshNotes', () => refreshNotes(deps)),
    vscode.commands.registerCommand('gutternotes.resolveOrphans', () =>
      resolveOrphans(deps)
    ),
    vscode.commands.registerCommand('gutternotes.exportNotes', () => exportNotes(deps)),
    vscode.commands.registerCommand('gutternotes.importNotes', () => importNotes(deps)),
    vscode.commands.registerCommand('gutternotes.installHook', () =>
      installHook(deps.repoPath)
    )
  );
}

// --- Add Note (with category picker + multi-line support) ---

async function addNote(deps: CommandDeps): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const line = editor.selection.active.line + 1; // 1-indexed
  const filePath = getRelativePath(deps.repoPath, editor.document.uri.fsPath);
  const lineText = editor.document.lineAt(line - 1).text;

  // Pick category
  const categoryItems = NOTE_CATEGORIES.map((cat) => ({
    label: `$(circle-filled) ${cat}`,
    description: '',
    category: cat,
  }));

  const picked = await vscode.window.showQuickPick(categoryItems, {
    placeHolder: 'Select note category',
  });
  if (!picked) return;
  const category = picked.category;

  // Get note text via multi-line editor for longer notes
  const text = await getMultiLineInput(`Add ${category} note for ${path.basename(filePath)}:${line}`);
  if (!text) return;

  // Build anchor
  let anchor: NoteAnchor;
  try {
    const blameLines = await blameFile(deps.repoPath, filePath);
    const blameLine = blameLines.find((bl) => bl.finalLine === line);
    const ZERO_COMMIT = '0000000000000000000000000000000000000000';

    if (blameLine && blameLine.originalCommit !== ZERO_COMMIT) {
      anchor = {
        kind: 'blame',
        data: {
          originCommit: blameLine.originalCommit,
          originFile: blameLine.originalFile,
          originLine: blameLine.originalLine,
          contentHash: blameLine.contentHash,
        },
      };
    } else {
      anchor = {
        kind: 'uncommitted',
        data: { lineNumber: line, contentHash: contentHash(lineText) },
      };
    }
  } catch {
    anchor = {
      kind: 'uncommitted',
      data: { lineNumber: line, contentHash: contentHash(lineText) },
    };
  }

  const note: CodeNote = {
    id: crypto.randomUUID(),
    file: filePath,
    anchor,
    text,
    category,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const newStore = storage.addNote(deps.getStore(), note);
  deps.setStore(newStore);
  await storage.saveNotes(newStore);
  await deps.refreshEditor(editor);
  deps.refreshTree();
  deps.updateStatusBar();
}

// --- Multi-line input via temp document ---

async function getMultiLineInput(title: string): Promise<string | undefined> {
  // For short notes, use input box. User can press Shift+Enter for multi-line via the document approach.
  const choice = await vscode.window.showQuickPick(
    [
      { label: 'Quick note', description: 'Single-line input box' },
      { label: 'Long note', description: 'Opens an editor for multi-line text' },
    ],
    { placeHolder: title }
  );

  if (!choice) return undefined;

  if (choice.label === 'Quick note') {
    return vscode.window.showInputBox({ prompt: title, placeHolder: 'Enter your note...' });
  }

  // Open a temp untitled document for multi-line editing
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: '' });
  const editor = await vscode.window.showTextDocument(doc, { preview: true });

  // Show instructions
  vscode.window.showInformationMessage(
    'Type your note, then run "GutterNotes: Save Note" (Cmd+Shift+P) or close the tab to save.'
  );

  return new Promise<string | undefined>((resolve) => {
    let resolved = false;

    // Resolve when the document is closed
    const closeListener = vscode.workspace.onDidCloseTextDocument((closed) => {
      if (closed === doc && !resolved) {
        resolved = true;
        closeListener.dispose();
        const text = doc.getText().trim();
        resolve(text || undefined);
      }
    });

    // Also resolve on save (Cmd+S)
    const saveListener = vscode.workspace.onDidSaveTextDocument((saved) => {
      if (saved === doc && !resolved) {
        resolved = true;
        closeListener.dispose();
        saveListener.dispose();
        const text = doc.getText().trim();
        // Close the temp document
        vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        resolve(text || undefined);
      }
    });
  });
}

// --- Edit Note ---

async function editNote(deps: CommandDeps, noteId?: string): Promise<void> {
  if (!noteId) return;

  const store = deps.getStore();
  const note = store.notes.find((n) => n.id === noteId);
  if (!note) return;

  const text = await vscode.window.showInputBox({
    prompt: 'Edit note',
    value: note.text,
  });

  if (text === undefined) return;

  const newStore = storage.updateNote(store, noteId, { text });
  deps.setStore(newStore);
  await storage.saveNotes(newStore);
  await deps.refreshEditor();
  deps.refreshTree();
}

// --- Delete Note ---

async function deleteNote(deps: CommandDeps, noteId?: string): Promise<void> {
  if (!noteId) return;

  const store = deps.getStore();
  const note = store.notes.find((n) => n.id === noteId);
  if (!note) return;

  const answer = await vscode.window.showWarningMessage(
    `Delete note: "${note.text.slice(0, 50)}"?`,
    'Delete',
    'Cancel'
  );
  if (answer !== 'Delete') return;

  const newStore = storage.deleteNote(store, noteId);
  deps.setStore(newStore);
  await storage.saveNotes(newStore);
  await deps.refreshEditor();
  deps.refreshTree();
  deps.updateStatusBar();
}

// --- Navigate to Note ---

async function navigateToNote(deps: CommandDeps, noteId?: string): Promise<void> {
  if (!noteId) return;

  const store = deps.getStore();
  const note = store.notes.find((n) => n.id === noteId);
  if (!note) return;

  try {
    const absPath = path.join(deps.repoPath, note.file);
    const doc = await vscode.workspace.openTextDocument(absPath);
    const editor = await vscode.window.showTextDocument(doc);

    const line = (note.resolvedLine ?? 1) - 1;
    const safeLine = Math.max(0, Math.min(line, doc.lineCount - 1));
    const range = new vscode.Range(safeLine, 0, safeLine, 0);
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  } catch (err) {
    vscode.window.showErrorMessage(
      `GutterNotes: Could not open file: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  }
}

// --- Next/Prev Note ---

async function jumpNote(deps: CommandDeps, direction: 'next' | 'prev'): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const filePath = getRelativePath(deps.repoPath, editor.document.uri.fsPath);
  const fileNotes = storage.getNotesForFile(deps.getStore(), filePath)
    .filter((n) => n.resolvedLine !== undefined && !n.orphaned)
    .sort((a, b) => a.resolvedLine! - b.resolvedLine!);

  if (fileNotes.length === 0) {
    vscode.window.showInformationMessage('GutterNotes: No notes in this file');
    return;
  }

  const currentLine = editor.selection.active.line + 1; // 1-indexed

  let target: CodeNote | undefined;
  if (direction === 'next') {
    target = fileNotes.find((n) => n.resolvedLine! > currentLine);
    if (!target) target = fileNotes[0]; // Wrap around
  } else {
    for (let i = fileNotes.length - 1; i >= 0; i--) {
      if (fileNotes[i].resolvedLine! < currentLine) {
        target = fileNotes[i];
        break;
      }
    }
    if (!target) target = fileNotes[fileNotes.length - 1]; // Wrap around
  }

  if (target && target.resolvedLine !== undefined) {
    const line = target.resolvedLine - 1;
    const range = new vscode.Range(line, 0, line, 0);
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }
}

// --- Search Notes ---

async function searchNotes(deps: CommandDeps): Promise<void> {
  const store = deps.getStore();
  if (store.notes.length === 0) {
    vscode.window.showInformationMessage('GutterNotes: No notes yet');
    return;
  }

  interface NotePickItem extends vscode.QuickPickItem {
    noteId: string;
  }

  const items: NotePickItem[] = store.notes.map((n) => {
    const cat = n.category || 'note';
    const line = n.resolvedLine ?? '?';
    const orphan = n.orphaned ? ' (orphaned)' : '';
    return {
      label: `$(${cat === 'note' ? 'comment' : cat === 'todo' ? 'check' : cat === 'question' ? 'question' : cat === 'bug' ? 'bug' : 'warning'}) ${n.text.slice(0, 80)}`,
      description: `${n.file}:${line}${orphan}`,
      detail: `[${cat}] ${relativeTime(n.updatedAt)}`,
      noteId: n.id,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Search notes...',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (selected) {
    await navigateToNote(deps, selected.noteId);
  }
}

// --- Refresh ---

async function refreshNotes(deps: CommandDeps): Promise<void> {
  const { invalidateAllCaches } = await import('./anchor');
  invalidateAllCaches();
  await deps.refreshEditor();
  deps.refreshTree();
  deps.updateStatusBar();
  vscode.window.showInformationMessage('GutterNotes: Refreshed all notes');
}

// --- Resolve Orphans (with re-anchor option) ---

async function resolveOrphans(deps: CommandDeps): Promise<void> {
  const store = deps.getStore();
  const orphans = store.notes.filter((n) => n.orphaned);

  if (orphans.length === 0) {
    vscode.window.showInformationMessage('GutterNotes: No orphaned notes');
    return;
  }

  interface OrphanPickItem extends vscode.QuickPickItem {
    noteId: string;
  }

  const items: OrphanPickItem[] = orphans.map((n) => ({
    label: n.text.slice(0, 60),
    description: n.file,
    detail: `Originally at line ${
      n.anchor.kind === 'blame' ? n.anchor.data.originLine : n.anchor.data.lineNumber
    }`,
    noteId: n.id,
  }));

  const selected = await vscode.window.showQuickPick<OrphanPickItem>(items, {
    placeHolder: 'Select an orphaned note to resolve',
  });

  if (!selected) return;

  const action = await vscode.window.showQuickPick(
    [
      { label: 'Re-anchor to cursor', description: 'Move note to current cursor position' },
      { label: 'Delete', description: 'Remove this note permanently' },
    ],
    { placeHolder: `What to do with: "${selected.label}"?` }
  );

  if (!action) return;

  if (action.label === 'Delete') {
    const newStore = storage.deleteNote(store, selected.noteId);
    deps.setStore(newStore);
    await storage.saveNotes(newStore);
  } else {
    // Re-anchor to current cursor
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('GutterNotes: Open a file and place cursor where you want the note');
      return;
    }

    const line = editor.selection.active.line + 1;
    const filePath = getRelativePath(deps.repoPath, editor.document.uri.fsPath);
    const lineText = editor.document.lineAt(line - 1).text;

    let anchor: NoteAnchor;
    try {
      const blameLines = await blameFile(deps.repoPath, filePath);
      const blameLine = blameLines.find((bl) => bl.finalLine === line);
      const ZERO_COMMIT = '0000000000000000000000000000000000000000';

      if (blameLine && blameLine.originalCommit !== ZERO_COMMIT) {
        anchor = {
          kind: 'blame',
          data: {
            originCommit: blameLine.originalCommit,
            originFile: blameLine.originalFile,
            originLine: blameLine.originalLine,
            contentHash: blameLine.contentHash,
          },
        };
      } else {
        anchor = {
          kind: 'uncommitted',
          data: { lineNumber: line, contentHash: contentHash(lineText) },
        };
      }
    } catch {
      anchor = {
        kind: 'uncommitted',
        data: { lineNumber: line, contentHash: contentHash(lineText) },
      };
    }

    const newStore = storage.updateNote(store, selected.noteId, { anchor });
    deps.setStore(newStore);
    await storage.saveNotes(newStore);
  }

  await deps.refreshEditor();
  deps.refreshTree();
  deps.updateStatusBar();
}

// --- Export/Import ---

async function exportNotes(deps: CommandDeps): Promise<void> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(deps.repoPath, 'gutternotes-export.json')),
    filters: { 'JSON files': ['json'] },
  });
  if (!uri) return;

  try {
    await storage.exportNotes(deps.getStore(), uri.fsPath);
    vscode.window.showInformationMessage(
      `GutterNotes: Exported ${deps.getStore().notes.length} notes to ${path.basename(uri.fsPath)}`
    );
  } catch (err) {
    vscode.window.showErrorMessage(`GutterNotes: Export failed: ${err}`);
  }
}

async function importNotes(deps: CommandDeps): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    filters: { 'JSON files': ['json'] },
    canSelectMany: false,
  });
  if (!uris || uris.length === 0) return;

  try {
    const imported = await storage.importNotes(uris[0].fsPath);
    const currentStore = deps.getStore();

    // Merge: add imported notes that don't already exist (by id)
    const existingIds = new Set(currentStore.notes.map((n) => n.id));
    const newNotes = imported.notes.filter((n) => !existingIds.has(n.id));

    if (newNotes.length === 0) {
      vscode.window.showInformationMessage('GutterNotes: No new notes to import');
      return;
    }

    const newStore: RepoNotesStore = {
      ...currentStore,
      notes: [...currentStore.notes, ...newNotes],
    };
    deps.setStore(newStore);
    await storage.saveNotes(newStore);
    await deps.refreshEditor();
    deps.refreshTree();
    deps.updateStatusBar();
    vscode.window.showInformationMessage(`GutterNotes: Imported ${newNotes.length} notes`);
  } catch (err) {
    vscode.window.showErrorMessage(`GutterNotes: Import failed: ${err}`);
  }
}

// --- Pre-commit Hook ---

async function installHook(repoPath: string): Promise<void> {
  const fs = await import('fs');
  const hooksDir = path.join(repoPath, '.git', 'hooks');
  const hookPath = path.join(hooksDir, 'pre-commit');

  const hookSnippet = `
# BEGIN GUTTERNOTES
# Safety net: prevent accidental note markers from being committed
if git diff --cached --diff-filter=ACM -U0 | grep -q '§n\\|GUTTERNOTE:'; then
  echo "GutterNotes: Found note markers in staged changes."
  echo "Please remove them before committing."
  exit 1
fi
# END GUTTERNOTES
`;

  try {
    await fs.promises.mkdir(hooksDir, { recursive: true });

    let existing = '';
    try {
      existing = await fs.promises.readFile(hookPath, 'utf-8');
    } catch {
      // No existing hook
    }

    if (existing.includes('BEGIN GUTTERNOTES')) {
      vscode.window.showInformationMessage('GutterNotes: Pre-commit hook already installed');
      return;
    }

    const content = existing
      ? existing.trimEnd() + '\n' + hookSnippet
      : '#!/bin/sh\n' + hookSnippet;

    await fs.promises.writeFile(hookPath, content, { mode: 0o755 });
    vscode.window.showInformationMessage('GutterNotes: Pre-commit hook installed');
  } catch (err) {
    vscode.window.showErrorMessage(`GutterNotes: Failed to install hook: ${err}`);
  }
}

// --- Helpers ---

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
