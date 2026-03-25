import * as vscode from 'vscode';
import { OllamaService } from '../services/ollamaService';
import { OllamaChatMessage } from '../types';

const OLLAMA_VENDOR = 'ollama-local';

interface OllamaLanguageModelInfo extends vscode.LanguageModelChatInformation {
  readonly id: string;
}

export function registerLanguageModelProvider(
  context: vscode.ExtensionContext,
  ollamaService: OllamaService
): void {
  const provider: vscode.LanguageModelChatProvider<OllamaLanguageModelInfo> = {
    provideLanguageModelChatInformation: async () => {
      try {
        const config = vscode.workspace.getConfiguration('ollamaChat');
        const configuredCtx = config.get<number>('contextWindowSize', 4096);
        const models = await ollamaService.listModels();

        return models.map((model) => {
          const [family, version] = model.name.split(':');
          return {
            id: model.name,
            name: model.name,
            family: family || 'ollama',
            version: version || 'latest',
            detail: 'Local Ollama model',
            tooltip: `Served by local Ollama: ${model.name}`,
            maxInputTokens: configuredCtx,
            maxOutputTokens: 2048,
            capabilities: {
              toolCalling: false,
            },
          } satisfies OllamaLanguageModelInfo;
        });
      } catch {
        return [];
      }
    },

    provideLanguageModelChatResponse: async (
      model,
      messages,
      _options,
      progress,
      token
    ) => {
      const config = vscode.workspace.getConfiguration('ollamaChat');
      const systemPrompt = config.get<string>(
        'systemPrompt',
        'You are a helpful coding assistant. Provide clear, concise, and correct code. When showing code, always specify the language in markdown code blocks.'
      );

      const ollamaMessages: OllamaChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...messages
          .map(toOllamaMessage)
          .filter((msg): msg is OllamaChatMessage => !!msg),
      ];

      token.onCancellationRequested(() => ollamaService.cancelStream());

      for await (const chunk of ollamaService.chatStream(ollamaMessages, model.id)) {
        progress.report(new vscode.LanguageModelTextPart(chunk));
      }
    },

    provideTokenCount: async (_model, text) => {
      const input = typeof text === 'string' ? text : flattenRequestMessage(text);
      // Lightweight token estimate when model tokenizer is not available.
      return Math.max(1, Math.ceil(input.length / 4));
    },
  };

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider(OLLAMA_VENDOR, provider)
  );
}

function toOllamaMessage(
  message: vscode.LanguageModelChatRequestMessage
): OllamaChatMessage | undefined {
  const content = flattenRequestMessage(message).trim();
  if (!content) {
    return undefined;
  }

  const role =
    message.role === vscode.LanguageModelChatMessageRole.Assistant
      ? 'assistant'
      : 'user';

  return { role, content };
}

function flattenRequestMessage(
  message: vscode.LanguageModelChatRequestMessage
): string {
  return message.content
    .map((part) => {
      if (part instanceof vscode.LanguageModelTextPart) {
        return part.value;
      }
      if (part instanceof vscode.LanguageModelToolResultPart) {
        return part.content
          .map((item) =>
            item instanceof vscode.LanguageModelTextPart ? item.value : ''
          )
          .join('\n');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}