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
        // Guard: ensure the picked modelId is a known supported model
        const validModel = SUPPORTED_MODELS.find(m => m.id === selected.modelId);
        if (!validModel) {
          return;
        }

        chatProvider.setModel(validModel.id);

        // Update default in settings
        const config = vscode.workspace.getConfiguration('ollamaChat');
        await config.update(
          'defaultModel',
          validModel.id,
          vscode.ConfigurationTarget.Global
        );

        // Check if model is available
        try {
          const models = await ollamaService.listModels();
          const installed = models.some((m) =>
            m.name.startsWith(validModel.id)
          );
          if (!installed) {
            const pull = await vscode.window.showWarningMessage(
              `Model "${validModel.id}" is not installed. Would you like to pull it?`,
              'Pull Model',
              'Cancel'
            );
            if (pull === 'Pull Model') {
              vscode.commands.executeCommand(
                'ollamaChat.pullModel',
                validModel.id
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
