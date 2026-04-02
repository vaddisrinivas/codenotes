export const NOTE_CATEGORIES = ['note', 'todo', 'question', 'bug', 'important'] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];

export const CATEGORY_COLORS: Record<NoteCategory, string> = {
  note: '#6b9eff',
  todo: '#4ec990',
  question: '#c98fff',
  bug: '#ff6b6b',
  important: '#ffb86b',
};

export const CATEGORY_ICONS: Record<NoteCategory, string> = {
  note: 'note',
  todo: 'todo',
  question: 'question',
  bug: 'bug',
  important: 'important',
};

export interface BlameAnchor {
  originCommit: string;
  originFile: string;
  originLine: number;
  contentHash: string;
}

export interface UncommittedAnchor {
  lineNumber: number;
  contentHash: string;
}

export type NoteAnchor =
  | { kind: 'blame'; data: BlameAnchor }
  | { kind: 'uncommitted'; data: UncommittedAnchor };

export interface CodeNote {
  id: string;
  file: string;
  anchor: NoteAnchor;
  text: string;
  category: NoteCategory;
  createdAt: string;
  updatedAt: string;
  orphaned?: boolean;
  resolvedLine?: number;
}

export interface RepoNotesStore {
  repoPath: string;
  repoHash: string;
  notes: CodeNote[];
  version: number;
}

export interface BlameLine {
  originalCommit: string;
  originalFile: string;
  originalLine: number;
  finalLine: number;
  lineContent: string;
  contentHash: string;
}

export interface BlameCache {
  blameLines: BlameLine[];
  mtime: number;
}
