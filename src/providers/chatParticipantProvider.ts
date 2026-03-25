import * as vscode from 'vscode';
import { ContextService } from '../services/contextService';
import { OllamaService } from '../services/ollamaService';
import { OllamaChatMessage, SupportedModel } from '../types';

const PARTICIPANT_ID = 'ollama-chat-local.ollama';

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  ollamaService: OllamaService,
  contextService: ContextService
): void {
  const handler: vscode.ChatRequestHandler = async (
    request,
    chatContext,
    stream,
    token
  ): Promise<vscode.ChatResult> => {
    const config = vscode.workspace.getConfiguration('ollamaChat');
    const model = config.get<SupportedModel>('defaultModel', 'codellama');
    const systemPrompt = config.get<string>(
      'systemPrompt',
      'You are a helpful coding assistant. Provide clear, concise, and correct code. When showing code, always specify the language in markdown code blocks.'
    );

    const connected = await ollamaService.isConnected();
    if (!connected) {
      stream.markdown(
        'Ollama is not reachable at the configured server URL. Run **Ollama Chat: Check Ollama Connection** and verify the Ollama daemon is running.'
      );
      return {
        errorDetails: {
          message: 'Ollama server is not connected.',
        },
      };
    }

    const slashInstruction = buildSlashInstruction(request.command);
    const mentionRefsPrompt = await buildReferencePrompt(request.references);
    const workspacePrompt = await contextService.buildContextPrompt();
    const historyMessages = extractHistoryMessages(chatContext.history);

    const finalUserPrompt = [
      slashInstruction,
      request.prompt,
      mentionRefsPrompt,
      workspacePrompt
        ? `\nAdditional workspace context:\n${workspacePrompt}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const messages: OllamaChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: finalUserPrompt },
    ];

    token.onCancellationRequested(() => ollamaService.cancelStream());
    stream.progress(`Using local model: ${model}`);

    try {
      for await (const chunk of ollamaService.chatStream(messages, model)) {
        stream.markdown(chunk);
      }

      return {
        metadata: {
          command: request.command,
        },
      };
    } catch (err) {
      return {
        errorDetails: {
          message: `Ollama request failed: ${(err as Error).message}`,
        },
      };
    }
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    'media',
    'icons',
    'ollama-chat.svg'
  );
  participant.followupProvider = {
    provideFollowups: () => {
      return [
        { prompt: 'Explain this in simpler terms', label: 'Simplify the explanation' },
        { prompt: 'Give me a minimal patch for this', label: 'Generate a patch' },
        { prompt: 'Write tests for this change', label: 'Add tests' },
      ];
    },
  };

  context.subscriptions.push(participant);
}

function buildSlashInstruction(command: string | undefined): string {
  switch (command) {
    case 'explain':
      return 'The user invoked /explain. Focus on clear explanation, tradeoffs, and concise examples.';
    case 'fix':
      return 'The user invoked /fix. Focus on root cause, minimal safe fix, and verification steps.';
    case 'tests':
      return 'The user invoked /tests. Focus on useful unit/integration tests and edge cases.';
    default:
      return '';
  }
}

async function buildReferencePrompt(
  references: readonly vscode.ChatPromptReference[]
): Promise<string> {
  if (!references.length) {
    return '';
  }

  const rendered: string[] = [];
  for (const ref of references) {
    const value = ref.value;

    if (typeof value === 'string') {
      rendered.push(`Reference: ${value}`);
      continue;
    }

    if (value instanceof vscode.Uri) {
      const fileContent = await readFileForReference(value);
      rendered.push(`Reference file ${vscode.workspace.asRelativePath(value)}:\n${fileContent}`);
      continue;
    }

    if (value instanceof vscode.Location) {
      const document = await vscode.workspace.openTextDocument(value.uri);
      const snippet = document.getText(value.range).trim();
      const target = `${vscode.workspace.asRelativePath(value.uri)}:${value.range.start.line + 1}`;
      rendered.push(`Reference selection ${target}:\n${snippet}`);
    }
  }

  return rendered.length
    ? `Prompt references:\n${rendered.join('\n\n')}`
    : '';
}

function extractHistoryMessages(
  history: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>
): OllamaChatMessage[] {
  const limitedHistory = history.slice(-6);
  const messages: OllamaChatMessage[] = [];

  for (const turn of limitedHistory) {
    if (turn instanceof vscode.ChatRequestTurn) {
      const prompt = turn.prompt.trim();
      if (prompt) {
        messages.push({ role: 'user', content: prompt });
      }
      continue;
    }

    if (turn instanceof vscode.ChatResponseTurn) {
      const text = turn.response
        .filter((part): part is vscode.ChatResponseMarkdownPart => part instanceof vscode.ChatResponseMarkdownPart)
        .map((part) => part.value.value)
        .join('\n')
        .trim();

      if (text) {
        messages.push({ role: 'assistant', content: text });
      }
    }
  }

  return messages;
}

async function readFileForReference(uri: vscode.Uri): Promise<string> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const raw = document.getText();
    return raw.length > 6000 ? `${raw.slice(0, 6000)}\n... (truncated)` : raw;
  } catch {
    return '(unable to read reference file)';
  }
}