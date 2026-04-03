import * as vscode from 'vscode';
import * as path from 'path';
import { CodeNote, NoteCategory, NOTE_CATEGORIES, CATEGORY_COLORS } from './types';

const categoryDecorationTypes = new Map<NoteCategory, vscode.TextEditorDecorationType>();
let orphanDecorationType: vscode.TextEditorDecorationType;

export function createDecorationTypes(context: vscode.ExtensionContext): void {
  const orphanPath = path.join(context.extensionPath, 'resources', 'icons', 'orphan.svg');

  for (const cat of NOTE_CATEGORIES) {
    const iconPath = path.join(context.extensionPath, 'resources', 'icons', `${cat}.svg`);
    const dt = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.file(iconPath),
      gutterIconSize: '80%',
    });
    categoryDecorationTypes.set(cat, dt);
    context.subscriptions.push(dt);
  }

  orphanDecorationType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.file(orphanPath),
    gutterIconSize: '80%',
    backgroundColor: 'rgba(232, 161, 63, 0.06)',
    isWholeLine: true,
  });
  context.subscriptions.push(orphanDecorationType);
}

export function applyDecorations(editor: vscode.TextEditor, notes: CodeNote[]): void {
  const config = vscode.workspace.getConfiguration('gutternotes');
  const showInline = config.get<boolean>('inlinePreview', true);
  const maxLen = config.get<number>('maxInlineLength', 60);
  const showOrphanWarning = config.get<boolean>('orphanWarning', true);

  // Group resolved notes by category
  const categoryBuckets = new Map<NoteCategory, vscode.DecorationOptions[]>();
  for (const cat of NOTE_CATEGORIES) {
    categoryBuckets.set(cat, []);
  }
  const orphaned: vscode.DecorationOptions[] = [];

  for (const note of notes) {
    if (note.orphaned) {
      if (!showOrphanWarning) continue;
      // Use last known anchor line, not line 1
      const lastKnownLine = note.anchor.kind === 'blame'
        ? note.anchor.data.originLine
        : note.anchor.data.lineNumber;
      const line = Math.max(0, Math.min(lastKnownLine - 1, editor.document.lineCount - 1));
      orphaned.push({
        range: new vscode.Range(line, 0, line, 0),
        renderOptions: {
          after: {
            contentText: `  ? orphaned: ${truncate(note.text, maxLen)}`,
            color: new vscode.ThemeColor('editorWarning.foreground'),
            fontStyle: 'italic',
            margin: '0 0 0 2em',
          },
        },
      });
      continue;
    }

    if (note.resolvedLine === undefined) continue;

    const line = note.resolvedLine - 1; // blame lines are 1-indexed
    if (line < 0 || line >= editor.document.lineCount) continue;

    const cat = note.category || 'note';
    const color = CATEGORY_COLORS[cat];
    const prefix = cat === 'note' ? '//' : `[${cat}]`;

    const opts: vscode.DecorationOptions = {
      range: new vscode.Range(line, 0, line, 0),
    };

    if (showInline) {
      opts.renderOptions = {
        after: {
          contentText: `  ${prefix} ${truncate(note.text, maxLen)}`,
          color,
          fontStyle: 'italic',
          margin: '0 0 0 2em',
        },
      };
    }

    categoryBuckets.get(cat)!.push(opts);
  }

  // Apply each category's decorations
  for (const [cat, decorations] of categoryBuckets) {
    const dt = categoryDecorationTypes.get(cat);
    if (dt) {
      editor.setDecorations(dt, decorations);
    }
  }
  editor.setDecorations(orphanDecorationType, orphaned);
}

export function clearDecorations(editor: vscode.TextEditor): void {
  for (const dt of categoryDecorationTypes.values()) {
    editor.setDecorations(dt, []);
  }
  editor.setDecorations(orphanDecorationType, []);
}

function truncate(text: string, max: number): string {
  const singleLine = text.replace(/\n/g, ' ');
  return singleLine.length <= max ? singleLine : singleLine.slice(0, max - 1) + '\u2026';
}
