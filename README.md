# Ollama Chat - Local AI Coding Assistant

A VS Code extension that provides a chat interface for interacting with local Ollama models, giving you the same AI-assisted development experience as cloud-based tools — but completely offline and private.

## Features

- **Chat Interface** — A sidebar chat panel that feels like native VS Code AI chat
- **Model Selection** — Choose between CodeLlama and DeepSeek-Coder
- **Streaming Responses** — Real-time token streaming for responsive interaction
- **Context Files** — Add workspace files as context for codebase-aware responses
- **Code Actions** — Right-click to explain or ask about selected code
- **Offline-First** — Works entirely without internet once set up
- **Theme-Aware** — Automatically matches your VS Code theme

## Quick Start

### 1. Install Ollama

Download and install from [ollama.ai](https://ollama.ai/download), or:

```bash
# Linux
curl -fsSL https://ollama.ai/install.sh | sh

# macOS (Homebrew)
brew install ollama
```

### 2. Pull a Model

```bash
# CodeLlama - broad language support, extensive documentation
ollama pull codellama

# DeepSeek-Coder - top benchmark performance, excellent code generation
ollama pull deepseek-coder
```

### 3. Install the VS Code Extension

For most users, install the packaged extension from GitHub Releases:

1. Open the latest release:

   https://github.com/jmcdonald69124/ollama-vscode-local/releases/latest

2. Download the `.vsix` file from the release assets.

3. Install it in VS Code using one of these methods:

   ```bash
   code --install-extension ollama-chat-local-0.1.1.vsix
   ```

   Or open VS Code and run:

   - `Cmd+Shift+P`
   - `Extensions: Install from VSIX...`
   - Select the downloaded `.vsix` file

If you are developing the extension instead of just using it, see [Installing the Extension](#installing-the-extension) below for the source-based workflow.

### 4. Start Chatting

1. Open VS Code
2. If you installed from source, use the Extension Development Host window
3. Click the Ollama Chat icon in the Activity Bar (sidebar)
4. Select your preferred model
5. Start asking questions!

## Model Comparison

| Feature | CodeLlama | DeepSeek-Coder |
|---------|-----------|----------------|
| Best for | General-purpose coding across many languages | Maximum code generation quality |
| Language breadth | Excellent | Very Good |
| Benchmark scores | Very Good | Excellent |
| Chinese code contexts | Good | Excellent |
| Community & docs | Excellent | Good |
| Smallest size | 3.8GB (7b) | 776MB (1.3b) |

## Context Files

Add files from your workspace to give the AI context about your codebase:

- **Right-click in Explorer** → "Add File to Context" or "Add Folder to Context"
- **Chat toolbar** → Click "Context" to manage files
- **Auto-include** — The active editor file is included automatically (configurable)

This enables codebase-aware responses that match your coding style and project patterns.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `ollamaChat.serverUrl` | `http://localhost:11434` | Ollama server URL |
| `ollamaChat.defaultModel` | `codellama` | Default model |
| `ollamaChat.temperature` | `0.7` | Generation temperature |
| `ollamaChat.contextWindowSize` | `4096` | Context window size |
| `ollamaChat.maxContextFiles` | `10` | Max context files |
| `ollamaChat.autoIncludeActiveFile` | `true` | Auto-include active file |
| `ollamaChat.systemPrompt` | *(coding assistant)* | System prompt |

## Commands

| Command | Description |
|---------|-------------|
| `Ollama Chat: New Chat` | Start a new chat session |
| `Ollama Chat: Select Model` | Switch between models |
| `Ollama Chat: Add File to Context` | Add a file as context |
| `Ollama Chat: Check Ollama Connection` | Test connection to Ollama |
| `Ollama Chat: Pull Model` | Download a model |
| `Ollama Chat: Setup Guide` | Open the setup walkthrough |
| `Ollama Chat: Explain Code with Ollama` | Explain selected code |
| `Ollama Chat: Ask Ollama About Selection` | Ask about selected code |

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Package extension
npm run package:vsix

# Build and verify a release-ready VSIX
npm run release:verify
```

Press F5 in VS Code to launch the Extension Development Host for testing.

## Installing the Extension

### Option A — Install from GitHub Releases (recommended)

1. Go to the latest release:

   https://github.com/jmcdonald69124/ollama-vscode-local/releases/latest

2. Download the attached `.vsix` file.

3. Install it in VS Code:

   ```bash
   code --install-extension ollama-chat-local-0.1.1.vsix
   ```

   Or from within VS Code: `Cmd+Shift+P` → **Extensions: Install from VSIX...** → select the `.vsix` file.

4. Reload VS Code when prompted.

### Option B — Build the `.vsix` yourself

1. **Install prerequisites**

   ```bash
   # Install Node.js (if not already installed)
   # https://nodejs.org

   # Install vsce (the VS Code extension packager)
   npm install -g @vscode/vsce
   ```

2. **Clone and build**

   ```bash
   git clone https://github.com/jmcdonald69124/ollama-vscode-local.git
   cd ollama-vscode-local
   npm install
   npm run package:vsix
   ```

   This produces a file like `ollama-chat-local-0.1.1.vsix`.

3. **Install in VS Code**

   ```bash
   code --install-extension ollama-chat-local-0.1.1.vsix
   ```

   Or from within VS Code: `Cmd+Shift+P` → **Extensions: Install from VSIX...** → select the `.vsix` file.

4. Reload VS Code when prompted.

### Option C — Run from source (for development)

1. Clone the repo and install dependencies (same as above).
2. Open the folder in VS Code.
3. Press **F5** — this opens an Extension Development Host with the extension already loaded.

### After installing

Follow the [Quick Start](#quick-start) steps above to install Ollama and pull a model, then click the Ollama Chat icon in the Activity Bar to start chatting.

## License

MIT
