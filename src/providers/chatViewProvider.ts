import * as vscode from 'vscode';
import { OllamaService } from '../services/ollamaService';
import { ContextService } from '../services/contextService';
import { ProjectDetector } from '../services/projectDetector';
import { StyleAnalyzer } from '../services/styleAnalyzer';
import { PromptEngine } from '../services/promptEngine';
import { RelevanceRanker } from '../services/relevanceRanker';
import { ConversationCompactor } from '../services/conversationCompactor';
import { PerformanceTuner } from '../services/performanceTuner';
import { ResponseCache } from '../services/responseCache';
import {
  ChatSession,
  OllamaChatMessage,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
  SupportedModel,
} from '../types';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ollamaChat.chatView';
  private _view?: vscode.WebviewView;
  private currentSession: ChatSession;
  private currentModel: SupportedModel;

  // Lazy-initialized services (only created on first use)
  private _projectDetector?: ProjectDetector;
  private _styleAnalyzer?: StyleAnalyzer;
  private _promptEngine?: PromptEngine;
  private _relevanceRanker?: RelevanceRanker;
  private _compactor?: ConversationCompactor;
  private _performanceTuner?: PerformanceTuner;
  private _responseCache?: ResponseCache;

  // Lazy getters — services are only instantiated on first message
  private get projectDetector(): ProjectDetector {
    return this._projectDetector ??= new ProjectDetector();
  }
  private get styleAnalyzer(): StyleAnalyzer {
    return this._styleAnalyzer ??= new StyleAnalyzer();
  }
  private get promptEngine(): PromptEngine {
    return this._promptEngine ??= new PromptEngine();
  }
  private get relevanceRanker(): RelevanceRanker {
    return this._relevanceRanker ??= new RelevanceRanker();
  }
  private get compactor(): ConversationCompactor {
    return this._compactor ??= new ConversationCompactor(this.ollamaService);
  }
  private get performanceTuner(): PerformanceTuner {
    return this._performanceTuner ??= new PerformanceTuner();
  }
  private get responseCache(): ResponseCache {
    return this._responseCache ??= new ResponseCache();
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
    private readonly ollamaService: OllamaService,
    private readonly contextService: ContextService
  ) {
    const config = vscode.workspace.getConfiguration('ollamaChat');
    this.currentModel = config.get<SupportedModel>(
      'defaultModel',
      'codellama'
    );
    this.currentSession = this.createNewSession();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      async (msg: WebviewToExtensionMessage) => {
        switch (msg.type) {
          case 'sendMessage':
            await this.handleUserMessage(msg.text);
            break;
          case 'cancelStream':
            this.ollamaService.cancelStream();
            break;
          case 'selectModel':
            vscode.commands.executeCommand('ollamaChat.selectModel');
            break;
          case 'addContextFile':
            vscode.commands.executeCommand('ollamaChat.addContextFile');
            break;
          case 'removeContextFile':
            this.contextService.removeFile(msg.uri);
            break;
          case 'clearChat':
            this.newChat();
            break;
          case 'newChat':
            this.newChat();
            break;
          case 'requestState':
            this.postMessage({
              type: 'restoreState',
              session: this.currentSession,
            });
            this.postMessage({
              type: 'modelChanged',
              model: this.currentModel,
            });
            this.postMessage({
              type: 'contextFilesUpdated',
              files: this.contextService.getFiles(),
            });
            this.checkAndReportConnection();
            break;
          case 'openSettings':
            vscode.commands.executeCommand(
              'workbench.action.openSettings',
              'ollamaChat'
            );
            break;
          case 'insertCodeToEditor':
            this.insertCodeToEditor(msg.code, msg.language);
            break;
          case 'checkConnection':
            this.checkAndReportConnection();
            break;
          case 'openSetupGuide':
            vscode.commands.executeCommand(
              'workbench.action.openWalkthrough',
              'ollama-chat.ollamaChat.setup',
              false
            );
            break;
          case 'pullModel':
            vscode.commands.executeCommand('ollamaChat.pullModel', msg.model);
            break;
          case 'recommendModels':
            vscode.commands.executeCommand('ollamaChat.recommendModels');
            break;
        }
      }
    );

    this.contextService.onDidChange((files) => {
      this.postMessage({ type: 'contextFilesUpdated', files });
    });
  }

  private async handleUserMessage(text: string): Promise<void> {
    if (!text.trim()) {
      return;
    }

    this.currentSession.messages.push({ role: 'user', content: text });

    const config = vscode.workspace.getConfiguration('ollamaChat');

    // 1. Get optimal performance params for this system
    const systemProfile = await this.performanceTuner.profileSystem();
    const perfParams = this.performanceTuner.getOptimalParams(systemProfile);

    // Use adaptive context window: override user setting if system is constrained
    const configuredCtx = config.get<number>('contextWindowSize', 4096);
    const contextWindowSize = Math.min(configuredCtx, perfParams.num_ctx);

    // 2. Check response cache (skip LLM call if we have a cached answer)
    const contextHash = this.responseCache.hashContext(
      this.contextService.getFiles().map(f => f.uri)
    );
    const cachedResponse = this.responseCache.get(text, this.currentModel, contextHash);
    if (cachedResponse && this.currentSession.messages.length <= 2) {
      // Only use cache for first-turn queries (no conversation context needed)
      this.postMessage({ type: 'streamChunk', content: cachedResponse });
      this.postMessage({ type: 'streamEnd' });
      this.currentSession.messages.push({
        role: 'assistant',
        content: cachedResponse,
      });
      this.saveSession();
      return;
    }

    // 3. Auto-detect project info and coding style in parallel
    const [projectInfo, codingStyle] = await Promise.all([
      this.projectDetector.detect(),
      this.styleAnalyzer.analyze(
        this.contextService.getFiles().map(f => f.uri)
      ),
    ]);

    // 4. Detect task type from query
    const taskType = this.promptEngine.detectTaskType(text);

    // 5. Rank and select relevant context files within token budget
    // Reserve ~35% of context window for system prompt + context
    const contextTokenBudget = Math.floor(contextWindowSize * 0.35);
    const rankedContext = await this.relevanceRanker.rankAndSelect(
      this.contextService.getFiles(),
      text,
      contextTokenBudget
    );

    // 6. Build model-specific system prompt
    const systemPrompt = this.promptEngine.buildSystemPrompt({
      model: this.currentModel,
      task: taskType,
      projectInfo: this.projectDetector.formatForPrompt(),
      styleGuide: this.styleAnalyzer.formatForPrompt(),
      contextFiles: rankedContext,
      userQuery: text,
    });

    // 7. Compact conversation history to fit remaining budget
    const compactedHistory = await this.compactor.compact(
      this.currentSession.messages,
      systemPrompt,
      contextWindowSize,
      this.currentModel
    );

    // 8. Assemble final messages
    const systemMessage: OllamaChatMessage = {
      role: 'system',
      content: systemPrompt,
    };
    const messagesToSend = [systemMessage, ...compactedHistory];

    try {
      let fullResponse = '';
      for await (const chunk of this.ollamaService.chatStream(
        messagesToSend,
        this.currentModel,
        {
          num_ctx: contextWindowSize,
          num_thread: perfParams.num_thread,
          num_gpu: perfParams.num_gpu,
          num_batch: perfParams.num_batch,
          low_vram: perfParams.low_vram,
          keep_alive: perfParams.keep_alive,
        }
      )) {
        fullResponse += chunk;
        this.postMessage({ type: 'streamChunk', content: chunk });
      }
      this.postMessage({ type: 'streamEnd' });
      this.currentSession.messages.push({
        role: 'assistant',
        content: fullResponse,
      });

      // Cache the response for future identical queries
      this.responseCache.set(text, this.currentModel, contextHash, fullResponse);

      this.saveSession();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        this.postMessage({ type: 'streamEnd' });
        return;
      }
      this.postMessage({
        type: 'streamError',
        error: (err as Error).message,
      });
    }
  }

  private async checkAndReportConnection(): Promise<void> {
    const connected = await this.ollamaService.isConnected();
    let models: string[] = [];
    if (connected) {
      try {
        const modelList = await this.ollamaService.listModels();
        models = modelList.map((m) => m.name);
      } catch {
        // Ignore
      }
    }
    this.postMessage({ type: 'ollamaStatus', connected, models });

    // Send detailed setup status for onboarding UI
    const selectedModelInstalled = models.some(
      (m) => m.startsWith(this.currentModel)
    );
    this.postMessage({
      type: 'setupStatus',
      status: {
        ollamaInstalled: connected, // If we can connect, it's installed
        ollamaRunning: connected,
        modelsAvailable: models,
        selectedModelInstalled,
        selectedModel: this.currentModel,
      },
    });
  }

  postMessage(msg: ExtensionToWebviewMessage): void {
    this._view?.webview.postMessage(msg);
  }

  newChat(): void {
    this.currentSession = this.createNewSession();
    this.postMessage({ type: 'restoreState', session: null });
  }

  setModel(model: SupportedModel): void {
    this.currentModel = model;
    this.postMessage({ type: 'modelChanged', model });
  }

  getModel(): SupportedModel {
    return this.currentModel;
  }

  sendPrompt(text: string): void {
    this.postMessage({ type: 'addUserMessage', text });
    this.handleUserMessage(text);
  }

  private insertCodeToEditor(code: string, language: string): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      editor.edit((editBuilder) => {
        editBuilder.replace(editor.selection, code);
      });
    } else {
      vscode.workspace
        .openTextDocument({ content: code, language })
        .then((doc) => {
          vscode.window.showTextDocument(doc);
        });
    }
  }

  private createNewSession(): ChatSession {
    return {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2),
      messages: [],
      model: this.currentModel,
      createdAt: Date.now(),
    };
  }

  private saveSession(): void {
    this.context.workspaceState.update(
      'ollamaChat.currentSession',
      this.currentSession
    );
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chat.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chat.css')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <link href="${styleUri}" rel="stylesheet">
    <title>Ollama Chat</title>
</head>
<body>
    <div id="app">
        <div id="toolbar">
            <div id="model-info">
                <span id="connection-status" class="status-dot disconnected" title="Checking connection..."></span>
                <span id="model-name" class="toolbar-btn" title="Click to change model">codellama</span>
            </div>
            <div id="toolbar-actions">
                <button id="context-btn" class="toolbar-btn" title="Add context files">
                    <span class="codicon">+</span> Context <span id="context-count" class="badge" style="display:none">0</span>
                </button>
                <button id="new-chat-btn" class="toolbar-btn" title="New chat">New Chat</button>
            </div>
        </div>

        <div id="context-drawer" style="display:none">
            <div id="context-header">
                <span>Context Files</span>
                <button id="add-context-btn" class="small-btn">+ Add</button>
            </div>
            <div id="context-list"></div>
        </div>

        <div id="connection-banner" style="display:none">
            <span>Ollama is not running. Run <code>ollama serve</code> or install from ollama.ai</span>
            <button id="retry-connection-btn" class="small-btn">Retry</button>
            <button id="setup-btn" class="small-btn">Setup Guide</button>
        </div>

        <div id="messages">
            <div id="welcome-message" class="welcome">
                <h2>Ollama Chat</h2>
                <p>Checking setup...</p>
            </div>
        </div>

        <div id="input-area">
            <div id="input-wrapper">
                <textarea id="user-input" placeholder="Checking Ollama connection..." rows="1" disabled></textarea>
                <button id="send-btn" title="Send message">Send</button>
                <button id="stop-btn" title="Stop generation" style="display:none">Stop</button>
            </div>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
