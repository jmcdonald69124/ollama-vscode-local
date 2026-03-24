import * as vscode from 'vscode';
import { OllamaService } from '../services/ollamaService';
import { ChatViewProvider } from '../providers/chatViewProvider';
import { SUPPORTED_MODELS } from '../constants';
import { SupportedModel } from '../types';

export function registerModelCommands(
  context: vscode.ExtensionContext,
  ollamaService: OllamaService,
  chatProvider: ChatViewProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ollamaChat.selectModel', async () => {
      const currentModel = chatProvider.getModel();

      const items = SUPPORTED_MODELS.map((m) => ({
        label: m.label,
        description:
          m.id === currentModel ? '(current)' : m.description,
        detail: m.detail,
        modelId: m.id,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        title: 'Select AI Model',
        placeHolder: 'Choose a model for chat',
      });

      if (selected) {
        chatProvider.setModel(selected.modelId as SupportedModel);

        // Update default in settings
        const config = vscode.workspace.getConfiguration('ollamaChat');
        await config.update(
          'defaultModel',
          selected.modelId,
          vscode.ConfigurationTarget.Global
        );

        // Check if model is available
        try {
          const models = await ollamaService.listModels();
          const installed = models.some((m) =>
            m.name.startsWith(selected.modelId)
          );
          if (!installed) {
            const pull = await vscode.window.showWarningMessage(
              `Model "${selected.modelId}" is not installed. Would you like to pull it?`,
              'Pull Model',
              'Cancel'
            );
            if (pull === 'Pull Model') {
              vscode.commands.executeCommand(
                'ollamaChat.pullModel',
                selected.modelId
              );
            }
          }
        } catch {
          // Ollama not connected, just set the model anyway
        }

        vscode.window.showInformationMessage(
          `Switched to ${selected.label}`
        );
      }
    })
  );
}
