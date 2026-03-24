import * as vscode from 'vscode';
import {
  OllamaChatMessage,
  OllamaChatResponseChunk,
  OllamaModelInfo,
  OllamaTagsResponse,
} from '../types';

const SAFE_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const DEFAULT_SERVER_URL = 'http://localhost:11434';
/** Allowed characters for model names: alphanumeric, dash, dot, colon, slash */
const MODEL_NAME_RE = /^[a-zA-Z0-9._:/-]{1,200}$/;

export class OllamaService {
  private abortController: AbortController | null = null;

  private get baseUrl(): string {
    const raw = vscode.workspace
      .getConfiguration('ollamaChat')
      .get<string>('serverUrl', DEFAULT_SERVER_URL);
    return this.validateServerUrl(raw);
  }

  private validateServerUrl(raw: string): string {
    try {
      const parsed = new URL(raw);
      if (!SAFE_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
        vscode.window.showWarningMessage(
          `Ollama server URL must point to localhost. Reverting to default.`
        );
        return DEFAULT_SERVER_URL;
      }
      // Only allow http/https schemes
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return DEFAULT_SERVER_URL;
      }
      // Return origin + path only (strip credentials/fragments)
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return DEFAULT_SERVER_URL;
    }
  }

  async isConnected(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<OllamaModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = (await response.json()) as OllamaTagsResponse;
      return data.models || [];
    } catch (err) {
      throw new Error(
        `Failed to list models: ${(err as Error).message}`
      );
    }
  }

  async *chatStream(
    messages: OllamaChatMessage[],
    model: string,
    options?: {
      temperature?: number;
      num_ctx?: number;
      num_thread?: number;
      num_gpu?: number;
      num_batch?: number;
      low_vram?: boolean;
      keep_alive?: string;
    }
  ): AsyncGenerator<string, void, unknown> {
    this.abortController = new AbortController();
    const config = vscode.workspace.getConfiguration('ollamaChat');

    const ollamaOptions: Record<string, unknown> = {
      temperature:
        options?.temperature ?? config.get<number>('temperature', 0.7),
      num_ctx:
        options?.num_ctx ?? config.get<number>('contextWindowSize', 4096),
    };

    // Performance tuning params (only set if provided)
    if (options?.num_thread) { ollamaOptions.num_thread = options.num_thread; }
    if (options?.num_gpu !== undefined) { ollamaOptions.num_gpu = options.num_gpu; }
    if (options?.num_batch) { ollamaOptions.num_batch = options.num_batch; }
    if (options?.low_vram) { ollamaOptions.low_vram = options.low_vram; }

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      options: ollamaOptions,
    };

    // keep_alive controls how long the model stays loaded in memory
    if (options?.keep_alive) {
      body.keep_alive = options.keep_alive;
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Ollama API error (${response.status}): ${body}`
      );
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          try {
            const chunk: OllamaChatResponseChunk = JSON.parse(line);
            if (chunk.message?.content) {
              yield chunk.message.content;
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const chunk: OllamaChatResponseChunk = JSON.parse(buffer);
          if (chunk.message?.content) {
            yield chunk.message.content;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    } finally {
      reader.releaseLock();
      this.abortController = null;
    }
  }

  cancelStream(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async pullModel(
    model: string,
    onProgress: (
      status: string,
      completed?: number,
      total?: number
    ) => void
  ): Promise<void> {
    if (!MODEL_NAME_RE.test(model)) {
      throw new Error(`Invalid model name: "${model}"`);
    }
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to pull model (${response.status}): ${body}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          try {
            const data = JSON.parse(line);
            onProgress(
              data.status || 'Downloading...',
              data.completed,
              data.total
            );
          } catch {
            // Skip malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
