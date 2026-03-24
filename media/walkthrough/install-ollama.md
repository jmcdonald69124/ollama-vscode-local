# Install Ollama

Ollama is a lightweight tool that lets you run large language models locally on your machine. It works completely offline once set up.

## Installation

### macOS
```bash
# Using the installer (recommended)
# Download from https://ollama.ai/download

# Or using Homebrew
brew install ollama
```

### Linux
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

### Windows
Download the installer from [ollama.ai/download](https://ollama.ai/download)

## Start Ollama

After installation, start the Ollama service:

```bash
# macOS / Linux - Ollama runs automatically after installation
# You can also start it manually:
ollama serve
```

The Ollama server runs on `http://localhost:11434` by default.

## Verify Installation

Run this command to verify Ollama is working:

```bash
ollama list
```

If you see an empty list or a list of models, Ollama is ready!

You can also click **Check Connection** in the extension to verify.
