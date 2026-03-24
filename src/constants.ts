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
    id: 'codellama',
    label: 'CodeLlama',
    description: 'Broad language support, extensive documentation',
    detail: 'Meta\'s CodeLlama is ideal for general-purpose coding across many languages. Best choice if you need broad language support, cloud accessibility, and extensive documentation.',
    ollamaTag: 'codellama',
  },
  {
    id: 'deepseek-coder',
    label: 'DeepSeek-Coder',
    description: 'Top benchmark performance, excellent code generation',
    detail: 'DeepSeek-Coder excels on coding benchmarks with top performance. Best choice if you need maximum code generation quality, especially with Chinese programming contexts.',
    ollamaTag: 'deepseek-coder',
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
