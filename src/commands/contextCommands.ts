import * as vscode from 'vscode';
import { ContextService } from '../services/contextService';
import { ChatViewProvider } from '../providers/chatViewProvider';

export function registerContextCommands(
  context: vscode.ExtensionContext,
  contextService: ContextService,
  chatProvider: ChatViewProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ollamaChat.addContextFile',
      async (uri?: vscode.Uri) => {
        if (uri) {
          contextService.addFile(uri);
          return;
        }

        const files = await vscode.window.showOpenDialog({
          canSelectMany: true,
          canSelectFolders: false,
          openLabel: 'Add to Context',
          title: 'Select files to add as context',
        });

        if (files) {
          for (const file of files) {
            contextService.addFile(file);
          }
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ollamaChat.addContextFolder',
      async (uri?: vscode.Uri) => {
        if (uri) {
          await contextService.addFolder(uri);
          return;
        }

        const folders = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFolders: true,
          canSelectFiles: false,
          openLabel: 'Add Folder to Context',
          title: 'Select folder to add as context',
        });

        if (folders && folders[0]) {
          await contextService.addFolder(folders[0]);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ollamaChat.removeContextFile',
      (uri?: string) => {
        if (uri) {
          contextService.removeFile(uri);
        }
      }
    )
  );
}
