import * as vscode from 'vscode';
import { CodeNote, CATEGORY_COLORS } from './types';

export type NoteResolver = (uri: vscode.Uri) => CodeNote[];

export function createHoverProvider(resolveNotes: NoteResolver): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      const notes = resolveNotes(document.uri);
      const note = notes.find(
        (n) => n.resolvedLine !== undefined && n.resolvedLine - 1 === position.line
      );

      if (!note) return undefined;

      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      md.supportHtml = true;

      if (note.orphaned) {
        md.appendMarkdown('$(warning) **Orphaned Note**\n\n');
        md.appendMarkdown(
          '*This note\'s anchor could not be resolved. The original line may have been deleted.*\n\n'
        );
      }

      // Category badge
      const cat = note.category || 'note';
      const color = CATEGORY_COLORS[cat];
      md.appendMarkdown(
        `<span style="color:${color};font-weight:bold">[${cat.toUpperCase()}]</span> ${escapeMarkdown(note.text)}\n\n`
      );
      md.appendMarkdown('---\n\n');

      const editArgs = encodeURIComponent(JSON.stringify([note.id]));
      const deleteArgs = encodeURIComponent(JSON.stringify([note.id]));

      md.appendMarkdown(
        `[$(edit) Edit](command:gutternotes.editNote?${editArgs}) &nbsp; ` +
          `[$(trash) Delete](command:gutternotes.deleteNote?${deleteArgs})\n\n`
      );

      // Relative timestamps
      const created = relativeTime(note.createdAt);
      const updated = relativeTime(note.updatedAt);
      md.appendMarkdown(`<span style="opacity:0.6">Created ${created}`);
      if (note.createdAt !== note.updatedAt) {
        md.appendMarkdown(` | Updated ${updated}`);
      }
      md.appendMarkdown('</span>');

      return new vscode.Hover(md);
    },
  };
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&');
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.floor(months / 12)}y ago`;
}
