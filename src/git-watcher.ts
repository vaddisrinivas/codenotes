import * as vscode from 'vscode';

export function createGitWatcher(
  workspaceFolder: vscode.WorkspaceFolder,
  onGitChange: () => void
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const debouncedChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onGitChange, 500);
  };

  // Watch .git/HEAD (branch switches, rebase completion)
  const headWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, '.git/HEAD')
  );
  headWatcher.onDidChange(debouncedChange);
  disposables.push(headWatcher);

  // Watch .git/MERGE_HEAD (merge completion)
  const mergeWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, '.git/MERGE_HEAD')
  );
  mergeWatcher.onDidChange(debouncedChange);
  mergeWatcher.onDidCreate(debouncedChange);
  mergeWatcher.onDidDelete(debouncedChange);
  disposables.push(mergeWatcher);

  // Watch refs (new commits)
  const refsWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, '.git/refs/heads/**')
  );
  refsWatcher.onDidChange(debouncedChange);
  refsWatcher.onDidCreate(debouncedChange);
  disposables.push(refsWatcher);

  return disposables;
}
