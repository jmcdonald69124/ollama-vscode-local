import * as vscode from 'vscode';
import { OllamaService } from './services/ollamaService';
import { ContextService } from './services/contextService';
import { PerformanceTuner } from './services/performanceTuner';
import { ChatViewProvider } from './providers/chatViewProvider';
import { OllamaCodeActionProvider } from './providers/codeActionProvider';
import { registerChatCommands } from './commands/chatCommands';
import { registerContextCommands } from './commands/contextCommands';
import { registerModelCommands } from './commands/modelCommands';
import { registerSetupCommands } from './commands/setupCommands';
import { registerChatParticipant } from './providers/chatParticipantProvider';
import { registerLanguageModelProvider } from './providers/languageModelProvider';

export function activate(context: vscode.ExtensionContext) {
  const ollamaService = new OllamaService();
  const contextService = new ContextService(context);
  const performanceTuner = new PerformanceTuner();

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
  registerChatParticipant(context, ollamaService, contextService);
  registerLanguageModelProvider(context, ollamaService);

  // Register performance-related commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ollamaChat.showSystemInfo',
      async () => {
        const profile = await performanceTuner.profileSystem();
        const params = performanceTuner.getOptimalParams(profile);
        const best = performanceTuner.getBestModel(profile);

        const info = [
          performanceTuner.formatProfile(profile),
          '',
          `Recommended Model: ${best.displayName} (${best.sizeGB}GB)`,
          '',
          'Auto-tuned Ollama Parameters:',
          `  Context Window: ${params.num_ctx}`,
          `  Threads: ${params.num_thread}`,
          `  GPU Layers: ${params.num_gpu}`,
          `  Batch Size: ${params.num_batch}`,
          `  Low VRAM Mode: ${params.low_vram}`,
          `  Keep Alive: ${params.keep_alive}`,
        ].join('\n');

        const action = await vscode.window.showInformationMessage(
          info,
          { modal: true },
          'View Model Recommendations'
        );

        if (action === 'View Model Recommendations') {
          performanceTuner.showRecommendationsQuickPick(profile);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ollamaChat.recommendModels',
      () => performanceTuner.showRecommendationsQuickPick()
    )
  );

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

  // On first activation: show walkthrough + resource advice
  if (!context.globalState.get('ollamaChat.walkthroughShown')) {
    vscode.commands.executeCommand(
      'workbench.action.openWalkthrough',
      'ollama-chat.ollamaChat.setup',
      false
    );
    context.globalState.update('ollamaChat.walkthroughShown', true);
  }

  // Show resource advice on first install (deferred to avoid blocking activation)
  if (!context.globalState.get('ollamaChat.resourceAdviceShown')) {
    setTimeout(async () => {
      await performanceTuner.showResourceAdvice();
      context.globalState.update('ollamaChat.resourceAdviceShown', true);
    }, 5000);
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
