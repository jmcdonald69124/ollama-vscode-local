# Configure & Start Chatting

You're all set! Here's how to get the most out of Ollama Chat.

## Adding Context Files

Context files help the AI understand your codebase and coding style. The AI will reference these files when answering your questions.

### How to Add Context
1. **From the Explorer**: Right-click a file or folder and select "Add File to Context" or "Add Folder to Context"
2. **From the Chat Panel**: Click the "Context" button in the toolbar and then "Add"
3. **Automatic**: The currently active file is automatically included as context (configurable in settings)

### Tips for Context Files
- Add your most important source files (models, utilities, core logic)
- Add style guides or coding standards if you have them
- Add configuration files to help the AI understand your project setup
- Keep it focused: fewer, more relevant files work better than many unrelated ones

## Using the Chat

- **Ask questions**: "How does the authentication work in this project?"
- **Generate code**: "Write a unit test for the UserService class"
- **Explain code**: Select code in the editor, right-click, and choose "Explain with Ollama"
- **Get help**: "What's the best way to handle errors in this function?"

## Code Actions

Select code in any file and right-click to see:
- **Explain with Ollama** - Get a detailed explanation of the selected code
- **Ask Ollama about this code** - Ask questions about the selection

## Settings

Configure the extension in VS Code Settings (search for "Ollama Chat"):
- **Server URL**: Change if Ollama runs on a different port
- **Default Model**: Choose between CodeLlama and DeepSeek-Coder
- **Temperature**: Control creativity (0 = deterministic, higher = more creative)
- **Context Window Size**: Larger values allow more context but use more memory
- **System Prompt**: Customize the AI's behavior

## Working Offline

Once Ollama and your models are installed, everything works completely offline. No internet connection is needed for:
- Chat conversations
- Code explanations
- Code generation
- All context-aware features

This makes it perfect for air-gapped environments, travel, or simply keeping your code private.
