import * as crypto from 'crypto';
import simpleGit from 'simple-git';
import { BlameLine, BlameCache, CodeNote, NoteAnchor } from './types';

const blameCache = new Map<string, BlameCache>();

export function contentHash(line: string): string {
  return crypto.createHash('sha256').update(line.trim()).digest('hex').slice(0, 16);
}

export function invalidateCache(filePath: string): void {
  blameCache.delete(filePath);
}

export function invalidateAllCaches(): void {
  blameCache.clear();
}

export async function blameFile(repoPath: string, filePath: string): Promise<BlameLine[]> {
  const cacheKey = filePath;
  const cached = blameCache.get(cacheKey);
  if (cached && Date.now() - cached.mtime < 5000) {
    return cached.blameLines;
  }

  const git = simpleGit(repoPath);
  let raw: string;
  try {
    raw = await git.raw(['blame', '--line-porcelain', '--', filePath]);
  } catch {
    return [];
  }

  const lines = raw.split('\n');
  const result: BlameLine[] = [];
  let i = 0;

  while (i < lines.length) {
    const header = lines[i];
    if (!header || header.length < 40) {
      i++;
      continue;
    }

    const headerParts = header.split(' ');
    if (headerParts.length < 3) {
      i++;
      continue;
    }

    const originalCommit = headerParts[0];
    const originalLine = parseInt(headerParts[1], 10);
    const finalLine = parseInt(headerParts[2], 10);
    i++;

    let originalFile = filePath;

    // Read metadata lines until we hit the tab-prefixed content line
    while (i < lines.length && !lines[i].startsWith('\t')) {
      const metaLine = lines[i];
      if (metaLine.startsWith('filename ')) {
        originalFile = metaLine.slice(9);
      }
      i++;
    }

    // Content line (starts with \t)
    let lineContent = '';
    if (i < lines.length && lines[i].startsWith('\t')) {
      lineContent = lines[i].slice(1);
      i++;
    }

    result.push({
      originalCommit,
      originalFile,
      originalLine,
      finalLine,
      lineContent,
      contentHash: contentHash(lineContent),
    });
  }

  blameCache.set(cacheKey, { blameLines: result, mtime: Date.now() });
  return result;
}

export interface ResolveResult {
  line: number | null;
  method: 'exact' | 'content' | 'orphaned';
}

export function resolveAnchor(anchor: NoteAnchor, blameLines: BlameLine[]): ResolveResult {
  if (anchor.kind === 'uncommitted') {
    // For uncommitted anchors, match by content hash
    for (const bl of blameLines) {
      if (bl.contentHash === anchor.data.contentHash) {
        return { line: bl.finalLine, method: 'content' };
      }
    }
    // Fallback: if line number is still valid, use it
    if (anchor.data.lineNumber <= blameLines.length) {
      return { line: anchor.data.lineNumber, method: 'content' };
    }
    return { line: null, method: 'orphaned' };
  }

  // Step 1: Exact match on (commit, file, line)
  for (const bl of blameLines) {
    if (
      bl.originalCommit === anchor.data.originCommit &&
      bl.originalFile === anchor.data.originFile &&
      bl.originalLine === anchor.data.originLine
    ) {
      return { line: bl.finalLine, method: 'exact' };
    }
  }

  // Step 2: Content hash match (line content survived in a new commit)
  for (const bl of blameLines) {
    if (bl.contentHash === anchor.data.contentHash) {
      return { line: bl.finalLine, method: 'content' };
    }
  }

  // Step 3: Orphaned
  return { line: null, method: 'orphaned' };
}

export async function resolveAllNotes(
  notes: CodeNote[],
  repoPath: string,
  relativeFilePath: string
): Promise<CodeNote[]> {
  const fileNotes = notes.filter((n) => n.file === relativeFilePath);
  if (fileNotes.length === 0) return notes;

  const blameLines = await blameFile(repoPath, relativeFilePath);
  if (blameLines.length === 0) {
    // Can't blame (new file, binary, etc.) — use line numbers as-is
    return notes.map((n) => {
      if (n.file !== relativeFilePath) return n;
      const line =
        n.anchor.kind === 'uncommitted'
          ? n.anchor.data.lineNumber
          : n.anchor.data.originLine;
      return { ...n, resolvedLine: line, orphaned: false };
    });
  }

  return notes.map((n) => {
    if (n.file !== relativeFilePath) return n;
    const result = resolveAnchor(n.anchor, blameLines);
    return {
      ...n,
      resolvedLine: result.line ?? undefined,
      orphaned: result.method === 'orphaned',
    };
  });
}

export function upgradeUncommittedAnchors(
  notes: CodeNote[],
  blameLines: BlameLine[],
  filePath: string
): CodeNote[] {
  const ZERO_COMMIT = '0000000000000000000000000000000000000000';
  return notes.map((n) => {
    if (n.file !== filePath || n.anchor.kind !== 'uncommitted') return n;

    // Find a blame line with matching content that has a real commit
    for (const bl of blameLines) {
      if (bl.contentHash === n.anchor.data.contentHash && bl.originalCommit !== ZERO_COMMIT) {
        return {
          ...n,
          anchor: {
            kind: 'blame' as const,
            data: {
              originCommit: bl.originalCommit,
              originFile: bl.originalFile,
              originLine: bl.originalLine,
              contentHash: bl.contentHash,
            },
          },
          updatedAt: new Date().toISOString(),
        };
      }
    }
    return n;
  });
}
