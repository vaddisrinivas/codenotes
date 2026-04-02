import * as vscode from 'vscode';
import * as path from 'path';
import simpleGit from 'simple-git';
import { RepoNotesStore } from './types';
import * as storage from './storage';
import {
  resolveAllNotes,
  invalidateCache,
  invalidateAllCaches,
  blameFile,
  upgradeUncommittedAnchors,
} from './anchor';
import { createDecorationTypes, applyDecorations, clearDecorations } from './decorations';
import { createHoverProvider } from './hover';
import { registerCommands, CommandDeps } from './commands';
import { NotesTreeProvider } from './tree';
import { createGitWatcher } from './git-watcher';

let store: RepoNotesStore;
let repoPath: string;
let treeProvider: NotesTreeProvider;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return;

  const workspaceFolder = folders[0];
  const git = simpleGit(workspaceFolder.uri.fsPath);

  try {
    repoPath = (await git.revparse(['--show-toplevel'])).trim();
  } catch {
    return; // Not a git repo
  }

  store = await storage.loadNotes(repoPath);
  createDecorationTypes(context);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'codenotes.searchNotes';
  statusBarItem.tooltip = 'Click to search notes';
  context.subscriptions.push(statusBarItem);

  // Tree view
  treeProvider = new NotesTreeProvider(context.extensionPath);
  treeProvider.setStore(store);
  const treeView = vscode.window.createTreeView('codenotes.notesList', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Command deps
  const deps: CommandDeps = {
    getStore: () => store,
    setStore: (s: RepoNotesStore) => {
      store = s;
      treeProvider.setStore(store);
    },
    repoPath,
    refreshEditor: (editor?: vscode.TextEditor) => refreshEditor(editor),
    refreshTree: () => treeProvider.refresh(),
    updateStatusBar: () => updateStatusBar(),
  };

  registerCommands(context, deps);

  // Hover provider
  const hoverProvider = createHoverProvider((uri: vscode.Uri) => {
    const relPath = getRelativePath(uri.fsPath);
    return storage.getNotesForFile(store, relPath);
  });
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider)
  );

  // Git watcher
  const watchers = createGitWatcher(workspaceFolder, async () => {
    invalidateAllCaches();
    await refreshAllEditors();
    treeProvider.refresh();
    updateStatusBar();
  });
  watchers.forEach((w) => context.subscriptions.push(w));

  // Editor change handlers
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor) {
        await refreshEditor(editor);
      }
      updateStatusBar();
    })
  );

  // BUG FIX #2: Only blame files that have notes
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const relPath = getRelativePath(doc.uri.fsPath);
      invalidateCache(relPath);

      const fileNotes = storage.getNotesForFile(store, relPath);
      if (fileNotes.length === 0) return; // Skip blame for files with no notes

      // Try to upgrade uncommitted anchors
      try {
        const blameLines = await blameFile(repoPath, relPath);
        if (blameLines.length > 0) {
          const upgraded = upgradeUncommittedAnchors(store.notes, blameLines, relPath);
          if (upgraded !== store.notes) {
            store = { ...store, notes: upgraded };
            await storage.saveNotes(store);
            treeProvider.setStore(store);
          }
        }
      } catch {
        // Blame failed — skip upgrade, not critical
      }

      const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.fsPath === doc.uri.fsPath
      );
      if (editor) {
        await refreshEditor(editor);
      }
    })
  );

  // BUG FIX #1: Immutable line-shift (no direct mutation)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length === 0) return;
      const relPath = getRelativePath(e.document.uri.fsPath);
      const fileNotes = storage.getNotesForFile(store, relPath);
      if (fileNotes.length === 0) return;

      let changed = false;
      const updatedNotes = store.notes.map((note) => {
        if (note.file !== relPath || note.resolvedLine === undefined) return note;

        let newLine = note.resolvedLine;
        for (const change of e.contentChanges) {
          const startLine = change.range.start.line + 1; // 1-indexed
          const oldEndLine = change.range.end.line + 1;
          const newLines = change.text.split('\n').length;
          const oldLines = oldEndLine - startLine + 1;
          const delta = newLines - oldLines;

          if (delta !== 0 && newLine > startLine) {
            newLine = Math.max(startLine, newLine + delta);
          }
        }

        if (newLine !== note.resolvedLine) {
          changed = true;
          return { ...note, resolvedLine: newLine };
        }
        return note;
      });

      if (changed) {
        store = { ...store, notes: updatedNotes };
        // Don't save — these are transient shifts. Save happens on blame re-resolve.
      }

      const editor = vscode.window.visibleTextEditors.find(
        (ed) => ed.document.uri.fsPath === e.document.uri.fsPath
      );
      if (editor) {
        const currentFileNotes = storage.getNotesForFile(store, relPath);
        applyDecorations(editor, currentFileNotes);
      }
    })
  );

  // Initial decoration + status bar
  if (vscode.window.activeTextEditor) {
    await refreshEditor(vscode.window.activeTextEditor);
  }
  updateStatusBar();
}

async function refreshEditor(editor?: vscode.TextEditor): Promise<void> {
  const target = editor ?? vscode.window.activeTextEditor;
  if (!target) return;

  const relPath = getRelativePath(target.document.uri.fsPath);

  // Only resolve if there are notes for this file
  const fileNotes = storage.getNotesForFile(store, relPath);
  if (fileNotes.length > 0) {
    store = { ...store, notes: await resolveAllNotes(store.notes, repoPath, relPath) };
    treeProvider.setStore(store);
    const resolved = storage.getNotesForFile(store, relPath);
    applyDecorations(target, resolved);
  } else {
    clearDecorations(target);
  }
}

async function refreshAllEditors(): Promise<void> {
  for (const editor of vscode.window.visibleTextEditors) {
    await refreshEditor(editor);
  }
}

function updateStatusBar(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    statusBarItem.hide();
    return;
  }

  const relPath = getRelativePath(editor.document.uri.fsPath);
  const fileNotes = storage.getNotesForFile(store, relPath);
  const totalNotes = store.notes.length;
  const orphanCount = store.notes.filter((n) => n.orphaned).length;

  if (totalNotes === 0) {
    statusBarItem.hide();
    return;
  }

  let text = `$(comment) ${fileNotes.length}`;
  if (fileNotes.length !== totalNotes) {
    text += `/${totalNotes}`;
  }
  if (orphanCount > 0) {
    text += ` $(warning) ${orphanCount}`;
  }

  statusBarItem.text = text;
  statusBarItem.show();
}

function getRelativePath(absolutePath: string): string {
  return path.relative(repoPath, absolutePath).replace(/\\/g, '/');
}

export function deactivate(): void {
  // Decoration types are disposed via context.subscriptions
}
