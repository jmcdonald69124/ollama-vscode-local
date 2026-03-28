export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    num_ctx?: number;
  };
}

export interface OllamaChatResponseChunk {
  model: string;
  created_at: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

export interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

export interface OllamaTagsResponse {
  models: OllamaModelInfo[];
}

export interface ChatSession {
  id: string;
  messages: OllamaChatMessage[];
  model: string;
  createdAt: number;
}

export interface ContextFile {
  uri: string;
  relativePath: string;
  language: string;
}

export type SupportedModel = 'codellama' | 'deepseek-coder';

export interface SetupStatus {
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  modelsAvailable: string[];
  selectedModelInstalled: boolean;
  selectedModel: string;
}

export type ExtensionToWebviewMessage =
  | { type: 'streamChunk'; content: string }
  | { type: 'streamEnd' }
  | { type: 'streamError'; error: string }
  | { type: 'modelChanged'; model: string }
  | { type: 'contextFilesUpdated'; files: ContextFile[] }
  | { type: 'ollamaStatus'; connected: boolean; models: string[] }
  | { type: 'restoreState'; session: ChatSession | null }
  | { type: 'addUserMessage'; text: string }
  | { type: 'setupStatus'; status: SetupStatus };

export type WebviewToExtensionMessage =
  | { type: 'sendMessage'; text: string }
  | { type: 'cancelStream' }
  | { type: 'selectModel' }
  | { type: 'addContextFile' }
  | { type: 'removeContextFile'; uri: string }
  | { type: 'clearChat' }
  | { type: 'newChat' }
  | { type: 'requestState' }
  | { type: 'openSettings' }
  | { type: 'insertCodeToEditor'; code: string; language: string }
  | { type: 'checkConnection' }
  | { type: 'openSetupGuide' }
  | { type: 'pullModel'; model: string }
  | { type: 'recommendModels' };
