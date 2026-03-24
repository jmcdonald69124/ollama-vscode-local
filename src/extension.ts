import * as vscode from 'vscode';
import { OllamaService } from './services/ollamaService';
import { ContextService } from './services/contextService';
import { ChatViewProvider } from './providers/chatViewProvider';
import { OllamaCodeActionProvider } from './providers/codeActionProvider';
import { registerChatCommands } from './commands/chatCommands';
import { registerContextCommands } from './commands/contextCommands';
import { registerModelCommands } from './commands/modelCommands';
import { registerSetupCommands } from './commands/setupCommands';

export function activate(context: vscode.ExtensionContext) {
  const ollamaService = new OllamaService();
  const contextService = new ContextService(context);

  const chatProvider = new ChatViewProvider(
    context.extensionUri,
    context,
    ollamaService,
    contextService
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      chatProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  registerChatCommands(context, chatProvider);
  registerContextCommands(context, contextService, chatProvider);
  registerModelCommands(context, ollamaService, chatProvider);
  registerSetupCommands(context, ollamaService);

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new OllamaCodeActionProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite] }
    )
  );

  // Status bar
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'ollamaChat.selectModel';
  context.subscriptions.push(statusBarItem);
  updateStatusBar(statusBarItem, ollamaService);

  // Update status bar when config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ollamaChat')) {
        updateStatusBar(statusBarItem, ollamaService);
      }
    })
  );

  // Show walkthrough on first activation
  if (!context.globalState.get('ollamaChat.walkthroughShown')) {
    vscode.commands.executeCommand(
      'workbench.action.openWalkthrough',
      'ollama-chat.ollamaChat.setup',
      false
    );
    context.globalState.update('ollamaChat.walkthroughShown', true);
  }
}

async function updateStatusBar(
  statusBarItem: vscode.StatusBarItem,
  ollamaService: OllamaService
) {
  const config = vscode.workspace.getConfiguration('ollamaChat');
  const model = config.get<string>('defaultModel', 'codellama');
  const connected = await ollamaService.isConnected();

  const icon = connected ? '$(check)' : '$(warning)';
  statusBarItem.text = `${icon} Ollama: ${model}`;
  statusBarItem.tooltip = connected
    ? `Connected to Ollama - Using ${model}`
    : 'Ollama is not connected. Click to configure.';
  statusBarItem.show();
}

export function deactivate() {}
