import * as vscode from 'vscode';
import { OllamaService } from '../services/ollamaService';
import { ChatViewProvider } from '../providers/chatViewProvider';
import { SUPPORTED_MODELS } from '../constants';

export function registerModelCommands(
  context: vscode.ExtensionContext,
  ollamaService: OllamaService,
  chatProvider: ChatViewProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ollamaChat.selectModel', async () => {
      const currentModel = chatProvider.getModel();

      const curatedItems = SUPPORTED_MODELS.map((m) => ({
        label: m.label,
        description:
          m.id === currentModel ? '(current)' : m.description,
        detail: m.detail,
        modelId: m.id,
      }));

      const installedItems: Array<{
        label: string;
        description: string;
        detail: string;
        modelId: string;
      }> = [];

      try {
        const installedModels = await ollamaService.listModels();
        const curatedIds = new Set(SUPPORTED_MODELS.map((m) => m.id));

        for (const model of installedModels) {
          if (curatedIds.has(model.name)) {
            continue;
          }
          installedItems.push({
            label: model.name,
            description:
              model.name === currentModel ? '(current)' : 'Installed in Ollama',
            detail: 'Detected from local Ollama instance',
            modelId: model.name,
          });
        }
      } catch {
        // If Ollama is unreachable, still show curated model choices.
      }

      const items = [...curatedItems, ...installedItems];

      const selected = await vscode.window.showQuickPick(items, {
        title: 'Select AI Model',
        placeHolder: 'Choose a model for chat',
      });

      if (selected) {
        chatProvider.setModel(selected.modelId);

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
