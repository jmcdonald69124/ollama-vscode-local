import * as vscode from 'vscode';
import * as path from 'path';
import { ContextFile } from '../types';
import { BINARY_FILE_EXTENSIONS, EXCLUDED_FOLDERS } from '../constants';

export class ContextService {
  private readonly _onDidChange = new vscode.EventEmitter<ContextFile[]>();
  readonly onDidChange = this._onDidChange.event;
  private contextFiles: Map<string, ContextFile> = new Map();

  constructor(private readonly context: vscode.ExtensionContext) {
    // Restore from workspace state
    const saved = context.workspaceState.get<ContextFile[]>(
      'ollamaChat.contextFiles',
      []
    );
    for (const file of saved) {
      this.contextFiles.set(file.uri, file);
    }
  }

  addFile(uri: vscode.Uri): void {
    const ext = path.extname(uri.fsPath).toLowerCase();
    if (BINARY_FILE_EXTENSIONS.has(ext)) {
      vscode.window.showWarningMessage(
        `Cannot add binary file: ${path.basename(uri.fsPath)}`
      );
      return;
    }

    const relativePath = vscode.workspace.asRelativePath(uri);
    const languageId = this.getLanguageId(ext);

    const file: ContextFile = {
      uri: uri.toString(),
      relativePath,
      language: languageId,
    };

    this.contextFiles.set(file.uri, file);
    this.save();
    this._onDidChange.fire(this.getFiles());
  }

  async addFolder(uri: vscode.Uri): Promise<void> {
    const config = vscode.workspace.getConfiguration('ollamaChat');
    const maxFiles = config.get<number>('maxContextFiles', 10);

    const pattern = new vscode.RelativePattern(uri, '**/*');
    const excludePattern = `{${EXCLUDED_FOLDERS.join(',')}}`;
    const files = await vscode.workspace.findFiles(
      pattern,
      excludePattern,
      maxFiles
    );

    let added = 0;
    for (const fileUri of files) {
      const ext = path.extname(fileUri.fsPath).toLowerCase();
      if (BINARY_FILE_EXTENSIONS.has(ext)) {
        continue;
      }
      if (this.contextFiles.size >= maxFiles) {
        vscode.window.showWarningMessage(
          `Reached maximum context files limit (${maxFiles}). Some files were not added.`
        );
        break;
      }
      this.addFile(fileUri);
      added++;
    }

    vscode.window.showInformationMessage(
      `Added ${added} file(s) to context.`
    );
  }

  removeFile(uri: string): void {
    this.contextFiles.delete(uri);
    this.save();
    this._onDidChange.fire(this.getFiles());
  }

  getFiles(): ContextFile[] {
    return Array.from(this.contextFiles.values());
  }

  clearAll(): void {
    this.contextFiles.clear();
    this.save();
    this._onDidChange.fire([]);
  }

  async buildContextPrompt(): Promise<string> {
    const files = this.getFiles();
    const config = vscode.workspace.getConfiguration('ollamaChat');
    const maxFiles = config.get<number>('maxContextFiles', 10);

    let prompt = '';
    const filesToInclude = files.slice(0, maxFiles);

    for (const file of filesToInclude) {
      try {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.parse(file.uri)
        );
        const content = doc.getText();
        // Truncate very large files
        const truncated =
          content.length > 10000
            ? content.substring(0, 10000) + '\n... (truncated)'
            : content;
        prompt += `\n--- File: ${file.relativePath} (${file.language}) ---\n`;
        prompt += truncated;
        prompt += '\n--- End File ---\n';
      } catch {
        // File may have been deleted
      }
    }

    // Auto-include active file
    if (config.get<boolean>('autoIncludeActiveFile', true)) {
      const activeEditor = vscode.window.activeTextEditor;
      if (
        activeEditor &&
        !this.contextFiles.has(activeEditor.document.uri.toString())
      ) {
        const relativePath = vscode.workspace.asRelativePath(
          activeEditor.document.uri
        );
        const content = activeEditor.document.getText();
        const truncated =
          content.length > 10000
            ? content.substring(0, 10000) + '\n... (truncated)'
            : content;
        prompt += `\n--- Active File: ${relativePath} (${activeEditor.document.languageId}) ---\n`;
        prompt += truncated;
        prompt += '\n--- End File ---\n';
      }
    }

    return prompt;
  }

  private save(): void {
    this.context.workspaceState.update(
      'ollamaChat.contextFiles',
      this.getFiles()
    );
  }

  private getLanguageId(ext: string): string {
    const map: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.c': 'c',
      '.cpp': 'cpp',
      '.cs': 'csharp',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.md': 'markdown',
      '.sql': 'sql',
      '.sh': 'shellscript',
      '.bash': 'shellscript',
      '.r': 'r',
      '.lua': 'lua',
      '.dart': 'dart',
      '.vue': 'vue',
    };
    return map[ext] || 'plaintext';
  }
}
