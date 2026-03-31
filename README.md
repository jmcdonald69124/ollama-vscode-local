# Ollama Chat - Local AI Coding Assistant

A VS Code extension that provides a chat interface for interacting with local Ollama models, giving you the same AI-assisted development experience as cloud-based tools — but completely offline and private.

## Requirements

| Requirement | Version |
|-------------|---------|
| **VS Code** | **Insiders** (1.100+) — required for the proposed Chat API |
| **Ollama** | Any recent version |
| **Node.js** | 20+ (development only) |

> **VS Code Insiders is required.** This extension uses the `chatProvider` proposed API, which is not available in stable VS Code. Download Insiders at [code.visualstudio.com/insiders](https://code.visualstudio.com/insiders/).

## Features

- **Native VS Code Chat Participant** — Use `@ollama` directly in the VS Code Chat panel
- **Sidebar Chat Panel** — A dedicated chat view with streaming responses
- **Tool Calling** — Models can invoke VS Code tools in agent mode
- **Model Selection** — Choose any model installed in Ollama
- **Context Files** — Add workspace files as context for codebase-aware responses
- **Code Actions** — Right-click to explain or ask about selected code
- **Offline-First** — Works entirely without internet once set up
- **Theme-Aware** — Automatically matches your VS Code theme

## Quick Start

### 1. Install VS Code Insiders

Download from [code.visualstudio.com/insiders](https://code.visualstudio.com/insiders/) and use it in place of stable VS Code.

### 2. Install Ollama

Download and install from [ollama.ai](https://ollama.ai/download), or:

```bash
# macOS (Homebrew)
brew install ollama

# Linux
curl -fsSL https://ollama.ai/install.sh | sh
```

Start Ollama (if it doesn't start automatically):

```bash
ollama serve
```

### 3. Pull a Model

```bash
# Recommended: fast, code-focused, supports tool calling
ollama pull qwen2.5-coder:7b
```

Any model available in Ollama will appear in the extension automatically.

### 4. Install the VS Code Extension

**Option A — Install from GitHub Releases (easiest)**

1. Go to the [latest release](https://github.com/jmcdonald69124/ollama-vscode-local/releases/latest)
2. Download the `.vsix` file from the release assets
3. Install it in VS Code Insiders:

   ```bash
   code-insiders --install-extension ollama-chat-local-0.1.1.vsix
   ```

   Or open VS Code Insiders and run:
   - `Cmd+Shift+P` → **Extensions: Install from VSIX...** → select the `.vsix` file

4. Reload VS Code Insiders when prompted

**Option B — Build the `.vsix` yourself**

```bash
# Prerequisites: Node.js 20+, then install the packager
npm install -g @vscode/vsce

# Clone, build, and package
git clone https://github.com/jmcdonald69124/ollama-vscode-local.git
cd ollama-vscode-local
npm install
npm run package:vsix

# Install the generated .vsix
code-insiders --install-extension ollama-chat-local-0.1.1.vsix
```

**Option C — Run from source (development)**

```bash
git clone https://github.com/jmcdonald69124/ollama-vscode-local.git
cd ollama-vscode-local
npm install
```

Open the folder in VS Code Insiders and press **F5** — this launches an Extension Development Host with the extension loaded.

### 5. Start Chatting

- **`@ollama` in Chat** — Open the Chat panel (`Ctrl+Alt+I`) and type `@ollama your question`
- **Sidebar panel** — Click the Ollama Chat icon in the Activity Bar
- **Slash commands** — `/explain`, `/fix`, `/tests` in the `@ollama` chat participant
- **Code actions** — Right-click a selection → "Ask Ollama About Selection" or "Explain Code with Ollama"

## Model

The default model is `qwen2.5-coder:7b` — fine-tuned on code, supports tool calling, and runs well on most machines with a GPU (~4.7GB).

You can switch to any model installed in Ollama by clicking the model name in the toolbar or running `Ollama Chat: Select Model`. Run `ollama list` to see what you have installed.

## Context Files

Add files from your workspace to give the AI context about your codebase:

- **Right-click in Explorer** → "Add File to Context" or "Add Folder to Context"
- **Auto-include** — The active editor file is included automatically (configurable)

## Configuration

Open VS Code Settings (`Cmd+,`) and search for "Ollama Chat".

### General

| Setting | Default | Description |
|---------|---------|-------------|
| `ollamaChat.serverUrl` | `http://localhost:11434` | Ollama server URL |
| `ollamaChat.defaultModel` | `qwen3-coder` | Default model (any `ollama list` name) |
| `ollamaChat.temperature` | `0.3` | Generation temperature. Lower (0.1–0.3) is better for code and tool calling; higher (0.7+) for creative tasks |
| `ollamaChat.contextWindowSize` | `16384` | Context window in tokens. Larger = more history, more memory |
| `ollamaChat.maxContextFiles` | `10` | Maximum workspace files to include in prompts |
| `ollamaChat.systemPrompt` | *(coding assistant)* | System prompt sent with every request |
| `ollamaChat.autoIncludeActiveFile` | `true` | Auto-include the active editor file as context |

### Performance

| Setting | Default | Description |
|---------|---------|-------------|
| `ollamaChat.keepAlive` | `30m` | How long to keep the model loaded between requests. Prevents the 3–10s reload delay. Use `"-1"` to keep it loaded indefinitely, `"0"` to unload immediately after each response |
| `ollamaChat.numBatch` | `512` | Prompt processing batch size. Larger values (1024–2048) speed up prompt ingestion at the cost of more GPU memory |
| `ollamaChat.numGpu` | `-1` | GPU layers to offload (`-1` = auto, `0` = CPU-only). Reduce if you're running out of VRAM |

**Tip for faster responses:** Set `keepAlive` to `"-1"` if you chat frequently. This keeps the model in memory at all times and eliminates the per-request load delay.

## Commands

| Command | Description |
|---------|-------------|
| `Ollama Chat: New Chat` | Start a new chat session |
| `Ollama Chat: Select Model` | Switch between installed Ollama models |
| `Ollama Chat: Add File to Context` | Add a file as context |
| `Ollama Chat: Check Ollama Connection` | Test connection to Ollama |
| `Ollama Chat: Pull Model` | Download a model from Ollama |
| `Ollama Chat: Setup Guide` | Open the setup walkthrough |
| `Ollama Chat: Explain Code with Ollama` | Explain selected code |
| `Ollama Chat: Ask Ollama About Selection` | Ask about selected code |
| `Ollama Chat: Show System Info & Performance` | View system and performance info |
| `Ollama Chat: Recommend Models for My System` | Get model recommendations |

## Troubleshooting

**Extension doesn't appear or `@ollama` isn't available**
- Make sure you're using **VS Code Insiders**, not stable VS Code
- Run `Ollama Chat: Check Ollama Connection` to verify Ollama is running

**Slow first response**
- The model is loading into memory. Subsequent responses will be faster once the model is warm
- Increase `ollamaChat.keepAlive` to keep it loaded between sessions

**Out of memory / model crashes**
- Reduce `ollamaChat.contextWindowSize` (try `8192`)
- Reduce `ollamaChat.numBatch` (try `256`)
- Set `ollamaChat.numGpu` to a lower number to limit GPU layer offloading
- Switch to a smaller model

**Tool calling not working**
- Use `qwen3-coder` or `qwen3:8b` — not all models support tool calling
- Keep `temperature` at `0.3` or lower

## Development

```bash
# Install dependencies
npm install

# Compile once
npm run compile

# Watch mode (recompiles on change)
npm run watch

# Package as .vsix
npm run package:vsix

# Build and verify a release-ready VSIX
npm run release:verify
```

Press **F5** in VS Code Insiders to launch the Extension Development Host for testing.

## License

MIT
