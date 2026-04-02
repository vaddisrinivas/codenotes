import * as vscode from 'vscode';
import * as path from 'path';
import { CodeNote, RepoNotesStore, CATEGORY_ICONS } from './types';

type TreeItem = FileItem | NoteItem;

class FileItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly noteCount: number,
    public readonly orphanCount: number
  ) {
    super(filePath, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${noteCount} note${noteCount !== 1 ? 's' : ''}`;
    this.iconPath = new vscode.ThemeIcon('file');
    this.contextValue = 'fileItem';
    if (orphanCount > 0) {
      this.description += ` (${orphanCount} orphaned)`;
    }
  }
}

class NoteItem extends vscode.TreeItem {
  constructor(public readonly note: CodeNote, extensionPath: string) {
    const maxLen = 50;
    const text = note.text.replace(/\n/g, ' ');
    const label = text.length <= maxLen ? text : text.slice(0, maxLen - 1) + '\u2026';
    super(label, vscode.TreeItemCollapsibleState.None);

    const cat = note.category || 'note';
    const line = note.resolvedLine ?? '?';
    this.description = `L${line}`;
    this.tooltip = `[${cat}] ${note.text}`;
    this.contextValue = 'noteItem';

    if (note.orphaned) {
      this.iconPath = vscode.Uri.file(
        path.join(extensionPath, 'resources', 'icons', 'orphan.svg')
      );
      this.description += ' (orphaned)';
    } else {
      const iconName = CATEGORY_ICONS[cat] || 'note';
      this.iconPath = vscode.Uri.file(
        path.join(extensionPath, 'resources', 'icons', `${iconName}.svg`)
      );
    }

    this.command = {
      command: 'codenotes.navigateToNote',
      title: 'Go to Note',
      arguments: [note.id],
    };
  }
}

export class NotesTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private store: RepoNotesStore | undefined;
  private extensionPath: string;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
  }

  setStore(store: RepoNotesStore): void {
    this.store = store;
    this._onDidChangeTreeData.fire(undefined);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!this.store) return [];

    if (!element) {
      const fileMap = new Map<string, CodeNote[]>();
      for (const note of this.store.notes) {
        const existing = fileMap.get(note.file) || [];
        existing.push(note);
        fileMap.set(note.file, existing);
      }

      const items: FileItem[] = [];
      for (const [filePath, notes] of fileMap) {
        const orphanCount = notes.filter((n) => n.orphaned).length;
        items.push(new FileItem(filePath, notes.length, orphanCount));
      }
      return items.sort((a, b) => a.filePath.localeCompare(b.filePath));
    }

    if (element instanceof FileItem) {
      const notes = this.store.notes.filter((n) => n.file === element.filePath);
      return notes
        .sort((a, b) => (a.resolvedLine ?? 0) - (b.resolvedLine ?? 0))
        .map((n) => new NoteItem(n, this.extensionPath));
    }

    return [];
  }
}
