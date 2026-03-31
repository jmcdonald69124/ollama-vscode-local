import { SupportedModel } from './types';

export interface ModelDefinition {
  id: SupportedModel;
  label: string;
  description: string;
  detail: string;
  ollamaTag: string;
}

export const SUPPORTED_MODELS: ModelDefinition[] = [
  {
    id: 'qwen-coder',
    label: 'Qwen Coder (tuned)',
    description: 'Tuned for precision, speed, and Claude-like responses (recommended)',
    detail: 'qwen2.5-coder:7b with custom sampling (temp 0.15, top_k 40) and a Claude-style system prompt baked in. Low temperature for accurate code, direct responses, no filler.',
    ollamaTag: 'qwen-coder',
  },
  {
    id: 'qwen2.5-coder:7b',
    label: 'Qwen2.5 Coder 7B',
    description: 'Base model — use if you want default settings',
    detail: 'Qwen2.5-Coder 7B base without custom tuning.',
    ollamaTag: 'qwen2.5-coder:7b',
  },
];

export const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful coding assistant. Provide clear, concise, and correct code. When showing code, always specify the language in markdown code blocks.';

export const BINARY_FILE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.avi', '.mov',
  '.woff', '.woff2', '.ttf', '.eot',
  '.pyc', '.class', '.o', '.obj',
]);

export const EXCLUDED_FOLDERS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/out/**',
  '**/build/**',
  '**/.vscode-test/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/vendor/**',
];
