import * as vscode from 'vscode';
import { OllamaService } from '../services/ollamaService';
import { SUPPORTED_MODELS } from '../constants';

export function registerSetupCommands(
  context: vscode.ExtensionContext,
  ollamaService: OllamaService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ollamaChat.checkOllamaStatus',
      async () => {
        const connected = await ollamaService.isConnected();
        if (connected) {
          try {
            const models = await ollamaService.listModels();
            const modelNames = models.map((m) => m.name).join(', ');
            vscode.window.showInformationMessage(
              `Ollama is connected! Installed models: ${modelNames || 'none'}`
            );
          } catch {
            vscode.window.showInformationMessage(
              'Ollama is connected but could not list models.'
            );
          }
        } else {
          const action = await vscode.window.showErrorMessage(
            'Cannot connect to Ollama. Make sure Ollama is installed and running.',
            'Open Setup Guide',
            'Open Settings'
          );
          if (action === 'Open Setup Guide') {
            vscode.commands.executeCommand(
              'workbench.action.openWalkthrough',
              'ollama-chat.ollamaChat.setup',
              false
            );
          } else if (action === 'Open Settings') {
            vscode.commands.executeCommand(
              'workbench.action.openSettings',
              'ollamaChat'
            );
          }
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ollamaChat.pullModel',
      async (modelName?: string) => {
        let model = modelName;

        if (!model) {
          const items = SUPPORTED_MODELS.map((m) => ({
            label: m.label,
            description: m.description,
            detail: `Pull ${m.ollamaTag} from Ollama`,
            modelTag: m.ollamaTag,
          }));

          const selected = await vscode.window.showQuickPick(items, {
            title: 'Pull Model',
            placeHolder: 'Select a model to download',
          });

          if (!selected) {
            return;
          }
          model = selected.modelTag;
        }

        const connected = await ollamaService.isConnected();
        if (!connected) {
          vscode.window.showErrorMessage(
            'Cannot connect to Ollama. Please make sure Ollama is running.'
          );
          return;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Pulling ${model}...`,
            cancellable: false,
          },
          async (progress) => {
            try {
              await ollamaService.pullModel(
                model!,
                (status, completed, total) => {
                  let message = status;
                  if (completed && total) {
                    const pct = Math.round((completed / total) * 100);
                    message = `${status} (${pct}%)`;
                    progress.report({ increment: 0, message });
                  } else {
                    progress.report({ message });
                  }
                }
              );
              vscode.window.showInformationMessage(
                `Successfully pulled ${model}! You can now use it in chat.`
              );
            } catch (err) {
              vscode.window.showErrorMessage(
                `Failed to pull ${model}: ${(err as Error).message}`
              );
            }
          }
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ollamaChat.openWalkthrough', () => {
      vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        'ollama-chat.ollamaChat.setup',
        false
      );
    })
  );
}
