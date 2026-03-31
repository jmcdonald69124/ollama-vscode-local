import * as vscode from 'vscode';
import { OllamaService } from '../services/ollamaService';
import { OllamaChatMessage } from '../types';

const OLLAMA_VENDOR = 'ollama-local';

const outputChannel = vscode.window.createOutputChannel('Ollama LM Provider');

interface OllamaLanguageModelInfo extends vscode.LanguageModelChatInformation {
  readonly id: string;
}

export function registerLanguageModelProvider(
  context: vscode.ExtensionContext,
  ollamaService: OllamaService
): void {
  const changeEmitter = new vscode.EventEmitter<void>();

  // Model list cache to avoid hammering Ollama on every provideLanguageModelChatInformation call
  let cachedModelInfos: OllamaLanguageModelInfo[] | null = null;
  let modelCacheTime = 0;
  const MODEL_CACHE_TTL = 10000; // 10 seconds

  outputChannel.appendLine(`[Ollama LM] Registering language model provider with vendor: ${OLLAMA_VENDOR}`);
  outputChannel.appendLine(`[Ollama LM] vscode.lm available: ${!!vscode.lm}`);
  outputChannel.appendLine(`[Ollama LM] registerLanguageModelChatProvider available: ${typeof vscode.lm?.registerLanguageModelChatProvider}`);

  // Re-query available models when the Ollama config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ollamaChat')) {
        outputChannel.appendLine('[Ollama LM] Configuration changed, firing change event');
        cachedModelInfos = null; // invalidate cache on config change
        changeEmitter.fire();
      }
    })
  );

  const provider: vscode.LanguageModelChatProvider<OllamaLanguageModelInfo> = {
    onDidChangeLanguageModelChatInformation: changeEmitter.event,

    provideLanguageModelChatInformation: async (
      _options: vscode.PrepareLanguageModelChatModelOptions,
      _token: vscode.CancellationToken
    ): Promise<OllamaLanguageModelInfo[]> => {
      outputChannel.appendLine(`[Ollama LM] provideLanguageModelChatInformation called (silent=${_options.silent})`);
      try {
        if (cachedModelInfos && Date.now() - modelCacheTime < MODEL_CACHE_TTL) {
          outputChannel.appendLine(`[Ollama LM] Returning ${cachedModelInfos.length} cached model infos`);
          return cachedModelInfos;
        }

        const config = vscode.workspace.getConfiguration('ollamaChat');
        const configuredCtx = config.get<number>('contextWindowSize', 4096);
        const models = await ollamaService.listModels();
        outputChannel.appendLine(`[Ollama LM] Found ${models.length} models: ${models.map(m => m.name).join(', ')}`);

        const result = models.map((model) => {
          const [family, version] = model.name.split(':');
          return {
            id: model.name,
            name: model.name,
            family: family || 'ollama',
            version: version || 'latest',
            detail: 'Local Ollama model',
            tooltip: `Served by local Ollama: ${model.name}`,
            maxInputTokens: configuredCtx,
            maxOutputTokens: configuredCtx,
            isUserSelectable: true,
            isDefault: false,
            category: { label: 'Ollama Local', order: 100 },
            capabilities: {
              toolCalling: true,
            },
          } satisfies OllamaLanguageModelInfo;
        });
        outputChannel.appendLine(`[Ollama LM] Returning ${result.length} model infos`);
        cachedModelInfos = result;
        modelCacheTime = Date.now();
        return result;
      } catch (err) {
        outputChannel.appendLine(`[Ollama LM] Error listing models: ${err}`);
        return [];
      }
    },

    provideLanguageModelChatResponse: async (
      model: OllamaLanguageModelInfo,
      messages: readonly vscode.LanguageModelChatRequestMessage[],
      options: vscode.ProvideLanguageModelChatResponseOptions,
      progress: vscode.Progress<vscode.LanguageModelResponsePart>,
      token: vscode.CancellationToken
    ): Promise<void> => {
      outputChannel.appendLine(`[Ollama LM] provideLanguageModelChatResponse called for model: ${model.id}`);
      outputChannel.appendLine(`[Ollama LM] Options keys: ${Object.keys(options).join(', ')}`);
      outputChannel.appendLine(`[Ollama LM] Messages count: ${messages.length}`);

      const ollamaMessages: OllamaChatMessage[] = messages
        .map(toOllamaMessage)
        .filter((msg): msg is OllamaChatMessage => !!msg);

      // VS Code passes tools on the options object at runtime even though the
      // proposed d.ts only declares `requestInitiator`.
      const anyOptions = options as any;
      const ollamaTools = anyOptions.tools?.map((tool: any) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema ?? {},
        },
      }));

      token.onCancellationRequested(() => ollamaService.cancelStream());

      const config = vscode.workspace.getConfiguration('ollamaChat');
      const configuredCtx = config.get<number>('contextWindowSize', 16384);
      const keepAlive = config.get<string>('keepAlive', '30m');
      const numBatch = config.get<number>('numBatch', 512);
      const numGpuRaw = config.get<number>('numGpu', -1);
      const numGpu = numGpuRaw === -1 ? undefined : numGpuRaw;

      for await (const chunk of ollamaService.chatStream(
        ollamaMessages,
        model.id,
        {
          num_ctx: configuredCtx,
          num_batch: numBatch,
          ...(numGpu !== undefined && { num_gpu: numGpu }),
          keep_alive: keepAlive,
        },
        ollamaTools
      )) {
        if (typeof chunk === 'string') {
          progress.report(new vscode.LanguageModelTextPart(chunk));
        } else {
          // Tool call response from the model
          progress.report(
            new vscode.LanguageModelToolCallPart(
              chunk.id,
              chunk.name,
              chunk.arguments
            )
          );
        }
      }
    },

    provideTokenCount: async (
      _model: OllamaLanguageModelInfo,
      text: string | vscode.LanguageModelChatRequestMessage,
      _token: vscode.CancellationToken
    ): Promise<number> => {
      const input = typeof text === 'string' ? text : flattenRequestMessage(text);
      return Math.max(1, Math.ceil(input.length / 4));
    },
  };

  try {
    const disposable = vscode.lm.registerLanguageModelChatProvider(OLLAMA_VENDOR, provider);
    context.subscriptions.push(disposable);
    outputChannel.appendLine('[Ollama LM] Successfully registered language model chat provider');
  } catch (err) {
    outputChannel.appendLine(`[Ollama LM] FAILED to register provider: ${err}`);
  }

  // Fire once after a short delay so VS Code re-queries models after Ollama connects
  const timer = setTimeout(() => {
    outputChannel.appendLine('[Ollama LM] Firing delayed change event');
    changeEmitter.fire();
  }, 3000);
  context.subscriptions.push({ dispose: () => clearTimeout(timer) });
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