import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { CodeNote, RepoNotesStore } from './types';

const STORE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.codenotes'
);
const STORE_VERSION = 1;

export function getRepoHash(repoPath: string): string {
  return crypto.createHash('sha256').update(repoPath).digest('hex').slice(0, 16);
}

export function getStorePath(repoPath: string): string {
  const hash = getRepoHash(repoPath);
  return path.join(STORE_DIR, hash, 'notes.json');
}

export async function loadNotes(repoPath: string): Promise<RepoNotesStore> {
  const storePath = getStorePath(repoPath);
  try {
    const raw = await fs.promises.readFile(storePath, 'utf-8');
    const store = JSON.parse(raw) as RepoNotesStore;
    if (store.version !== STORE_VERSION) {
      store.version = STORE_VERSION;
    }
    // Backfill category for notes from older versions
    for (const note of store.notes) {
      if (!note.category) {
        note.category = 'note';
      }
    }
    return store;
  } catch (err: unknown) {
    // If file doesn't exist, return empty store (expected on first run)
    if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyStore(repoPath);
    }
    // For parse errors or other issues, warn the user and create backup
    vscode.window.showWarningMessage(
      `CodeNotes: Could not load notes (${err instanceof Error ? err.message : 'unknown error'}). Starting with empty store. A backup was saved.`
    );
    try {
      const backup = storePath + '.backup.' + Date.now();
      await fs.promises.copyFile(storePath, backup);
    } catch {
      // Backup failed too — nothing we can do
    }
    return emptyStore(repoPath);
  }
}

function emptyStore(repoPath: string): RepoNotesStore {
  return {
    repoPath,
    repoHash: getRepoHash(repoPath),
    notes: [],
    version: STORE_VERSION,
  };
}

// Serialize saves to prevent concurrent write corruption
let saveChain = Promise.resolve();

export async function saveNotes(store: RepoNotesStore): Promise<void> {
  saveChain = saveChain.then(async () => {
    const storePath = getStorePath(store.repoPath);
    const dir = path.dirname(storePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = storePath + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(store, null, 2), 'utf-8');
    await fs.promises.rename(tmp, storePath);
  });
  return saveChain;
}

export function addNote(store: RepoNotesStore, note: CodeNote): RepoNotesStore {
  return { ...store, notes: [...store.notes, note] };
}

export function updateNote(store: RepoNotesStore, id: string, updates: Partial<Pick<CodeNote, 'text' | 'category' | 'anchor'>>): RepoNotesStore {
  return {
    ...store,
    notes: store.notes.map((n) =>
      n.id === id ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n
    ),
  };
}

export function deleteNote(store: RepoNotesStore, id: string): RepoNotesStore {
  return { ...store, notes: store.notes.filter((n) => n.id !== id) };
}

export function getNotesForFile(store: RepoNotesStore, filePath: string): CodeNote[] {
  return store.notes.filter((n) => n.file === filePath);
}

export async function exportNotes(store: RepoNotesStore, targetPath: string): Promise<void> {
  await fs.promises.writeFile(targetPath, JSON.stringify(store, null, 2), 'utf-8');
}

export async function importNotes(filePath: string): Promise<RepoNotesStore> {
  const raw = await fs.promises.readFile(filePath, 'utf-8');
  const store = JSON.parse(raw) as RepoNotesStore;
  for (const note of store.notes) {
    if (!note.category) note.category = 'note';
  }
  return store;
}
