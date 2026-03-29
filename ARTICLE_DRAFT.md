# Building a Local AI Coding Assistant: VS Code + Ollama + Small Language Models

## The Premise

GitHub Copilot Chat changed how developers interact with code. But it requires an internet connection, sends your code to external servers, and costs money. What if you could have the same experience — a chat sidebar in VS Code, context-aware code assistance, streaming responses — running entirely on your laptop, with zero cloud dependency?

That's what we built: an open-source VS Code extension that connects to Ollama, giving you a local, private, offline-first AI coding assistant. This article covers the full journey — the architecture, the pain points, and honest thoughts on where small language models actually stand for coding tasks.

---

## The Architecture at a Glance

```
VS Code Extension
├── Webview UI (HTML/CSS/JS chat interface)
├── ChatViewProvider (orchestrates everything)
├── OllamaService (REST API client, streaming)
├── ContextService (workspace file management)
├── ProjectDetector (auto-detect language/framework)
├── StyleAnalyzer (detect coding conventions)
├── PromptEngine (model-specific prompt templates)
├── RelevanceRanker (smart context file scoring)
├── ConversationCompactor (context window management)
├── PerformanceTuner (system profiling + adaptive params)
└── ResponseCache (LRU cache with similarity matching)
```

~4,600 lines of TypeScript and JavaScript. No external dependencies beyond VS Code's extension API and Ollama's REST endpoint.

---

## The Big Decision: Custom Webview vs. VS Code's Native Chat API

This is where most of the interesting work lives, and where you'll spend most of your time if you attempt this.

VS Code offers two fundamentally different paths for building a chat experience:

### Path 1: Custom Webview (What We Started With)

Build your own HTML/CSS/JS chat interface inside a `WebviewViewProvider`. You own every pixel — the message bubbles, the input box, the streaming renderer, the markdown parser, the code block syntax highlighting.

```typescript
class ChatViewProvider implements vscode.WebviewViewProvider {
    resolveWebviewView(webviewView: vscode.WebviewView) {
        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
    }
}
```

**Pros:** Total control. Your chat looks and behaves exactly how you want.

**Cons:** You're reimplementing everything GitHub Copilot Chat already does. Message rendering, code block actions (copy, insert, apply diff), conversation history, keyboard shortcuts, accessibility — all of it. That's not a weekend project, it's a months-long UI effort to reach parity with the native experience users already know.

### Path 2: VS Code Chat Participant API (Where the Real Magic Is)

This is the path that gets you into the **actual VS Code chat window** — the same panel where users talk to `@workspace`, `@terminal`, and `@vscode`. Your extension registers as a **chat participant**, and users invoke it with `@ollama explain this function`.

```typescript
const participant = vscode.chat.createChatParticipant(
    'ollama-chat.ollama',
    async (request: vscode.ChatRequest, context: vscode.ChatContext,
           response: vscode.ChatResponseStream, token: vscode.CancellationToken) => {

        // Stream tokens directly into VS Code's native chat UI
        for await (const chunk of ollamaService.chatStream(messages, model)) {
            response.markdown(chunk);
        }
    }
);

participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'ollama.png');
```

This is the approach that makes your local model feel like a first-class citizen alongside Copilot. The user types in the same chat box, sees the same message formatting, gets the same code block actions (copy, insert at cursor, apply as diff), and can switch between `@ollama` and `@workspace` mid-conversation.

**But here's the catch:** The Chat Participant API is designed with the assumption that the model behind the participant is capable. It surfaces features — follow-up suggestions, inline code actions, reference resolution — that your participant needs to actually support. If your 7B model generates broken code and the user clicks "Apply in Editor," the experience is worse than not having the button at all.

### The Integration Surface Area

Registering a chat participant is the easy part. Making it feel native is where the work lives:

**1. Streaming into `ChatResponseStream`**

VS Code's `response.markdown()` expects well-formed markdown chunks. Ollama streams individual tokens — sometimes mid-word, sometimes mid-code-fence. You need a buffer that assembles coherent markdown fragments before pushing them to the response stream. Push too eagerly and you get flickering renders. Push too slowly and it feels laggy.

```typescript
let markdownBuffer = '';
for await (const token of ollamaService.chatStream(messages, model)) {
    markdownBuffer += token;

    // Only flush on natural boundaries: end of line, end of code fence,
    // or when buffer gets long enough that delay is noticeable
    if (token.includes('\n') || markdownBuffer.length > 80) {
        response.markdown(markdownBuffer);
        markdownBuffer = '';
    }
}
if (markdownBuffer) response.markdown(markdownBuffer);
```

**2. Handling `ChatContext` — Conversation History**

The `ChatContext` object gives you the previous turns in the conversation. But it's VS Code's representation of history, not Ollama's. You need to transform `ChatContext.history` into the `{ role, content }` message array that Ollama expects, including any inline code references and file context that VS Code attached to previous turns.

```typescript
function buildOllamaMessages(context: vscode.ChatContext): OllamaChatMessage[] {
    const messages: OllamaChatMessage[] = [];
    for (const turn of context.history) {
        if (turn instanceof vscode.ChatRequestTurn) {
            messages.push({ role: 'user', content: turn.prompt });
        } else if (turn instanceof vscode.ChatResponseTurn) {
            // ResponseTurn contains parts — markdown, code, references
            // You need to serialize these back into a single string
            const content = turn.response
                .map(part => {
                    if (part instanceof vscode.ChatResponseMarkdownPart) {
                        return part.value.value;
                    }
                    return '';
                })
                .join('');
            messages.push({ role: 'assistant', content });
        }
    }
    return messages;
}
```

**3. The `@` Mention and Slash Commands**

Once registered, users type `@ollama` to address your participant. You can also register slash commands for specific tasks:

```typescript
participant.followupProvider = {
    provideFollowups(result, context, token) {
        return [
            { prompt: 'Explain this in more detail', participant: 'ollama-chat.ollama' },
            { prompt: 'Write tests for this', participant: 'ollama-chat.ollama',
              command: 'test' }
        ];
    }
};
```

The challenge: follow-up suggestions need to be contextually relevant. Cloud models are good at generating these. A 7B local model? You're better off hardcoding common follow-ups per task type than asking the model to suggest them.

**4. Variable Resolution — `#file`, `#selection`, `#editor`**

VS Code chat supports variable references like `#file:src/index.ts` and `#selection`. When a user types `@ollama explain #selection`, VS Code resolves `#selection` to the actual selected text and passes it in `request.references`. Your participant needs to extract these and weave them into the prompt:

```typescript
for (const ref of request.references) {
    if (ref.value instanceof vscode.Uri) {
        // User referenced a file — read it and include as context
        const content = await vscode.workspace.fs.readFile(ref.value);
        contextFiles.push({ uri: ref.value, content: content.toString() });
    } else if (ref.value instanceof vscode.Location) {
        // User referenced a specific range — include just that snippet
        const doc = await vscode.workspace.openTextDocument(ref.value.uri);
        const text = doc.getText(ref.value.range);
        contextSnippets.push(text);
    }
}
```

This is genuinely powerful — it gives your local model the same context injection that Copilot gets. But it also means your token budget gets eaten faster, and you're back to the context window management problem.

### Why This Is Where You'll Spend Your Time

The custom webview approach took ~2,000 lines of HTML/CSS/JS just for the UI. The Chat Participant API gives you all of that for free — but demands that you solve harder integration problems instead:

- Mapping between VS Code's chat abstractions and Ollama's raw API
- Graceful degradation when the model produces malformed output
- Managing token budgets across VS Code-provided context and your own context injection
- Making a 7B model's output look credible in the same UI where GPT-4/Claude responses appear

The honest truth: **side-by-side with Copilot, local models look rough.** But that's also the most interesting design challenge — how do you build the UX to set appropriate expectations while still being genuinely useful?

---

## The Tool Calling Gap: The Elephant in the Chat Room

If you've used GitHub Copilot Chat or Claude in VS Code, you're accustomed to the model *doing things* — running terminal commands, reading files across your workspace, searching for symbols, editing code in place. That's not just the model being smart. That's **tool calling** (or function calling) — the model outputs structured requests like "read file X" or "run command Y," the host executes them, and feeds the results back.

This is where local small models hit their hardest wall.

### How Tool Calling Works in VS Code Chat

VS Code's Chat API supports a tool-use pattern. You register tools that your participant can invoke:

```typescript
// Register a tool the model can call
vscode.lm.registerTool('ollama-readFile', {
    async invoke(options: vscode.LanguageModelToolInvocationOptions,
                 token: vscode.CancellationToken) {
        const filePath = options.input.filePath;
        const content = await vscode.workspace.fs.readFile(
            vscode.Uri.file(filePath)
        );
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(content.toString())
        ]);
    }
});
```

The flow is: user asks a question → model decides it needs to read a file → model outputs a tool call → VS Code executes it → result goes back to the model → model incorporates it into its answer.

Copilot makes this look seamless because GPT-4 and Claude have been specifically trained for structured tool calling. They reliably output JSON tool invocations in the expected format.

### The Problem with Small Models and Tools

**Most 7B-13B models were not trained for tool calling.** They don't reliably output structured JSON tool invocations. Ask CodeLlama to call a function and you'll get something like:

```
I would suggest reading the file to understand the structure.
Let me look at src/index.ts for you.
```

That's a *description* of wanting to use a tool, not an actual tool call. The model talks about what it would do rather than emitting the structured format that VS Code needs to execute it.

### Approaches to Bridge the Gap

We explored several strategies, each with trade-offs:

**Strategy 1: Prompt-Based Tool Calling (Fragile but Simple)**

Inject tool descriptions into the system prompt and parse the model's output for structured patterns:

```typescript
const toolPrompt = `You have access to these tools. To use a tool, output EXACTLY this format:
<tool_call>{"name": "readFile", "arguments": {"path": "src/index.ts"}}</tool_call>

Available tools:
- readFile: Read a file's contents. Args: { path: string }
- searchWorkspace: Search for text across files. Args: { query: string }
- runCommand: Run a terminal command. Args: { command: string }

IMPORTANT: Output the tool_call tag EXACTLY as shown. Do not describe what you would do — actually call the tool.`;
```

Then parse the response stream, intercept `<tool_call>` blocks, execute them, and feed results back:

```typescript
let responseBuffer = '';
for await (const token of ollamaService.chatStream(messages, model)) {
    responseBuffer += token;

    const toolCallMatch = responseBuffer.match(
        /<tool_call>(.*?)<\/tool_call>/s
    );
    if (toolCallMatch) {
        try {
            const call = JSON.parse(toolCallMatch[1]);
            const result = await executeToolCall(call.name, call.arguments);

            // Feed the result back to the model as a new message
            messages.push({ role: 'assistant', content: responseBuffer });
            messages.push({ role: 'user', content: `Tool result:\n${result}` });

            // Continue the conversation with the tool result
            responseBuffer = '';
            for await (const token of ollamaService.chatStream(messages, model)) {
                response.markdown(token);
            }
        } catch (e) {
            // Model produced malformed tool call — just render it as text
            response.markdown(responseBuffer);
        }
        break;
    }
}
```

**Reality check:** This works maybe 40-60% of the time with 7B models. Common failures:
- Model outputs natural language instead of the structured format
- JSON is malformed (missing quotes, trailing commas)
- Model "hallucinates" tool names that don't exist
- Model calls tools in a loop, burning through the context window

**Strategy 2: Constrained Decoding via Ollama's Grammar Support**

Ollama supports GBNF grammars that constrain the model's output to valid formats. In theory, you can force the model to output valid tool-call JSON:

```
POST /api/chat
{
    "model": "codellama",
    "messages": [...],
    "format": {
        "type": "object",
        "properties": {
            "tool_call": { "type": "string" },
            "arguments": { "type": "object" }
        }
    }
}
```

This improves structural reliability — the JSON will be valid — but doesn't solve the semantic problem. The model might output `{"tool_call": "readFile", "arguments": {"path": "the main file"}}` instead of an actual path.

**Strategy 3: Two-Phase Response (Pragmatic Compromise)**

Instead of asking the model to make real-time tool decisions mid-response, split the flow:

1. **Phase 1 — Intent detection:** Ask the model a constrained question: "Does answering this require reading files, searching code, or running commands? Reply with ONLY a JSON array of actions needed, or NONE."
2. **Phase 2 — Prefetch and answer:** Execute the tools yourself, inject the results as context, then let the model answer with full information.

```typescript
async function handleWithTools(query: string, model: string) {
    // Phase 1: Ask what context is needed
    const intentPrompt = `Given this question: "${query}"
    What information do you need? Respond with ONLY a JSON array:
    [{"action": "readFile", "path": "..."}, {"action": "search", "query": "..."}]
    Or respond with: NONE`;

    const intent = await ollamaService.chatComplete(intentPrompt, model);

    // Phase 2: Gather context
    let additionalContext = '';
    if (intent !== 'NONE') {
        const actions = JSON.parse(intent);
        for (const action of actions) {
            if (action.action === 'readFile') {
                additionalContext += await readWorkspaceFile(action.path);
            } else if (action.action === 'search') {
                additionalContext += await searchWorkspace(action.query);
            }
        }
    }

    // Phase 3: Answer with full context
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Context:\n${additionalContext}\n\nQuestion: ${query}` }
    ];
    return ollamaService.chatStream(messages, model);
}
```

**This is the most reliable approach for small models.** The intent detection query is simple enough that even 7B models get it right most of the time. The trade-off is two round-trips to the model, which doubles latency for tool-using queries.

**Strategy 4: Use Tool-Capable Models (Emerging Option)**

Some newer small models are specifically fine-tuned for tool calling:
- **Llama 3.1/3.2** have native tool-calling support in their chat template
- **Mistral** models support function calling
- **Hermes** and **Functionary** fine-tunes are designed for structured output

If you can require users to pull a tool-capable model, you can use Ollama's native tool support:

```
POST /api/chat
{
    "model": "llama3.1",
    "messages": [...],
    "tools": [{
        "type": "function",
        "function": {
            "name": "readFile",
            "description": "Read a file from the workspace",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path relative to workspace root" }
                },
                "required": ["path"]
            }
        }
    }]
}
```

This is the cleanest solution, but it limits your model choices and the tool-calling reliability still varies significantly between models.

### What This Means for the User Experience

The tool calling gap creates a **visible UX divide** between local and cloud chat:

| Capability | Copilot Chat (Cloud) | Ollama Chat (Local) |
|---|---|---|
| Answer questions about code | Yes | Yes |
| Read files on demand | Seamlessly | Requires prefetch or unreliable |
| Search across workspace | Built-in | Manual context file selection |
| Run terminal commands | Yes, with confirmation | Not reliable enough to ship |
| Apply code edits inline | Yes | Can generate code, risky to auto-apply |
| Multi-step reasoning with tools | Yes | Context window too small for tool loops |

**Our honest approach:** We leaned into what local models do well (answering with pre-gathered context) and didn't try to fake tool-calling fluency. The context service, relevance ranker, and project detector essentially do the "tool work" upfront — gathering the right context before the model ever sees the query. It's less dynamic than real tool calling, but far more reliable.

The gap here is narrowing fast. As tool-calling fine-tunes improve and Ollama's native tool support matures, this will be the single biggest area of improvement for local coding assistants.

---

## Pain Point #1: The Streaming Response Problem

Ollama's `/api/chat` endpoint streams responses as newline-delimited JSON (NDJSON). Each chunk looks like:

```json
{"model":"codellama","message":{"role":"assistant","content":"Hello"},"done":false}
```

The gotcha: **`fetch` in Node.js doesn't give you `response.body.getReader()` the same way browsers do.** We used an `AsyncGenerator` pattern to yield tokens as they arrive:

```typescript
async *chatStream(messages, model, options) {
    const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({ model, messages, stream: true, options }),
        signal: this.abortController?.signal
    });

    const reader = response.body;
    let buffer = '';
    for await (const chunk of reader) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (line.trim()) {
                const parsed = JSON.parse(line);
                if (parsed.message?.content) {
                    yield parsed.message.content;
                }
            }
        }
    }
}
```

The buffer management is critical — NDJSON chunks don't always align with message boundaries. Without it, you get random `JSON.parse` failures mid-conversation.

---

## Pain Point #2: Context Windows Are Tiny

This is the elephant in the room. CodeLlama's default context window is 4,096 tokens. DeepSeek-Coder goes up to 16K, but on a resource-constrained laptop you might need to shrink it. Compare that to GPT-4's 128K or Claude's 200K.

We implemented a multi-strategy **conversation compactor**:

1. **Code block deduplication** — If the same code block appears in multiple messages, keep only the latest
2. **Large code block compression** — Replace 20+ line blocks with just their function/class signatures
3. **Sliding window** — Keep only the last 6 messages when history grows beyond the token budget
4. **Generative summarization** — Ask the model itself to summarize older conversation into a compact system message
5. **Extractive summarization** — Fallback: pull key sentences from old messages without using the model
6. **Message truncation** — Last resort: hard-cut individual messages to fit

The token budget calculation is rough (~4 chars per token) but functional. We reserve 70% of the context window for conversation, leaving 30% for the system prompt and context files.

**Honest take:** Even with all these strategies, conversations with 4K context models feel choppy after 3-4 exchanges. The model loses track of what you were discussing. 16K models are the practical minimum for a chat-like experience.

---

## Pain Point #3: Resource-Constrained Laptops

Running a 7B parameter model requires ~4-8GB of RAM just for the model weights. On a laptop with 8GB total RAM, that leaves almost nothing for VS Code, the OS, and your dev tools.

We built a **PerformanceTuner** that profiles the system and adapts:

| System Tier | RAM | Context Window | Threads | Strategy |
|---|---|---|---|---|
| Low (<6GB) | <6GB | 1024 tokens | 2 | `low_vram: true`, minimal batching |
| Medium (6-12GB) | 6-12GB | 2048 tokens | 4 | Balanced params |
| High (12GB+) | 12GB+ | 4096 tokens | 6 | Full GPU offload if available |

The tuner also detects GPU availability (CUDA, ROCm, Metal) and adjusts `num_gpu` layers accordingly.

**Model recommendations by RAM:**

| RAM | Recommended Models |
|---|---|
| 4GB | CodeLlama 7B Q4, DeepSeek-Coder 1.3B |
| 8GB | CodeLlama 7B, DeepSeek-Coder 6.7B Q4 |
| 16GB | CodeLlama 13B, DeepSeek-Coder 6.7B |
| 32GB+ | CodeLlama 34B Q4, DeepSeek-Coder 33B Q4 |

---

## Pain Point #4: Smart Context Without a Cloud Brain

Cloud-based assistants have massive context windows and can ingest entire repos. We don't have that luxury. So we built a **relevance ranker** that scores context files on:

- **Keyword overlap** with the user's query (weighted by term rarity)
- **Filename mentions** in the query (e.g., "what does chatService do?" boosts `chatService.ts`)
- **File type affinity** (TypeScript files score higher for TypeScript questions)
- **Core file boost** (config files, entry points, type definitions)
- **Active editor boost** (the file you're looking at is probably relevant)

When truncating files to fit the budget, we preserve:
- Import statements (dependency context)
- Function/class definitions (structural context)
- Lines containing query keywords (relevant context)

This "smart truncation" means the model sees the skeleton of the file plus the parts that matter, rather than a random 100-line slice.

---

## Pain Point #5: The "Just Install the Extension" Problem

This was a late realization. Unlike cloud-based extensions where you install and go, our extension requires:

1. **Install Ollama** (a separate application)
2. **Start the Ollama server** (`ollama serve`)
3. **Pull a model** (`ollama pull codellama` — a 3-7GB download)
4. **Then** use the extension

If any step is missing, the extension silently fails. We solved this with an **onboarding status checklist** in the chat panel:

```
┌──────────────────────────────────┐
│  Ollama Chat — Setup Required    │
│                                  │
│  ✅ Ollama Installed             │
│  ❌ Ollama Running               │
│     → Start with: ollama serve   │
│  ⚠️  No models pulled            │
│     → [Pull codellama]           │
│                                  │
│  [Open Setup Guide] [Check]      │
└──────────────────────────────────┘
```

The input box starts **disabled** until all checks pass. Error messages are contextual: ECONNREFUSED means "Ollama isn't running", 404 means "model not found — pull it", timeout means "try a smaller model."

---

## Pain Point #6: Model-Specific Prompting

CodeLlama and DeepSeek-Coder respond very differently to the same prompts. CodeLlama prefers structured, verbose system prompts with explicit formatting instructions. DeepSeek-Coder works better with concise, direct prompts.

We built a **PromptEngine** with 8 task types (explain, refactor, generate, debug, test, review, document, general) and separate template sets per model family. Task detection uses keyword matching on the user's query — crude but effective.

**Example difference:**

CodeLlama system prompt for "explain":
> "You are an expert code analyst. Provide clear, structured explanations. Use numbered steps. Include relevant concepts..."

DeepSeek-Coder system prompt for "explain":
> "Explain code concisely. Focus on what it does and why."

---

## Pain Point #7: Project and Style Detection

For the AI to give contextually appropriate suggestions, it needs to know your stack. Our **ProjectDetector** reads config files to auto-detect:

- Language (TypeScript, Python, Go, Rust, Java, Kotlin)
- Framework (React, Next.js, Django, FastAPI, Spring Boot, Gin, etc.)
- Test framework (Jest, Pytest, Go test, etc.)
- Linter, package manager, build tool

The **StyleAnalyzer** reads actual source files to detect:
- Indentation (tabs vs spaces, width)
- Naming conventions (camelCase, snake_case, PascalCase)
- Quote style, semicolons, import patterns
- Common patterns (async/await, React hooks, error handling idioms)

This gets injected into the system prompt so the model generates code that matches your existing style. It's a small thing that makes a big difference — nothing breaks trust faster than an AI that suggests `snake_case` in a `camelCase` codebase.

---

## The Git Journey: Bootstrapping a Repo from Scratch

A meta-pain-point worth mentioning: creating the initial PR when starting from an empty repository.

**Problem:** We had one branch with all the commits but no `main` branch to open a PR against.

**Attempt 1:** Create `main` from the same commit → PR shows zero diff (same SHA).

**Attempt 2:** Create orphan `main` with an empty initial commit → PR fails because the branches share no common ancestor.

**Solution:** Create orphan `main`, then rebase the feature branch onto it:

```bash
git checkout --orphan main
git rm -rf .
git commit --allow-empty -m "Initial commit"
git push -u origin main

git checkout feature-branch
git rebase main --allow-empty
git push --force-with-lease origin feature-branch
```

This gives both branches a common root, making the PR diff meaningful. It's a niche problem but one you'll hit if you're bootstrapping repos programmatically.

---

## Honest Thoughts on Small Language Models for Coding

After building this entire system to optimize the local coding experience, here's the unvarnished truth:

### What works well

- **Code explanation** — Small models are genuinely good at explaining what code does. 7B models can break down complex functions accurately.
- **Boilerplate generation** — Common patterns (React components, Express routes, CRUD operations) come out clean.
- **Rubber duck debugging** — Even when the model's suggestions aren't perfect, articulating the problem in a chat interface helps you think.
- **Privacy-sensitive codebases** — If you're working on proprietary code that can't leave your machine, local models are the only option.
- **Offline development** — Planes, trains, coffee shops with bad WiFi. Your coding assistant still works.

### What doesn't work well

- **Complex reasoning across files** — With 4K-16K context windows, the model simply can't hold enough of your codebase in memory to understand cross-file interactions.
- **Architectural suggestions** — "How should I restructure this service?" requires understanding the entire system. Small models give generic advice.
- **Novel problem solving** — For problems that require genuine reasoning rather than pattern matching, the gap between 7B and 70B+ models is enormous.
- **Long conversations** — Even with compaction strategies, conversations degrade noticeably after the context window fills up. The model starts contradicting itself or forgetting constraints.
- **Accuracy on edge cases** — Type gymnastics in TypeScript, complex SQL queries, async race conditions — small models hallucinate more in these areas.

### The sweet spot

**7B-13B models on 16GB+ RAM** is currently the practical sweet spot for local coding assistance. Below that, you're fighting context limits and resource constraints too much. Above that (33B+), you need serious hardware.

The ideal workflow isn't "replace Copilot/Claude with a local model." It's:
1. **Use local models** for routine tasks, explanations, and boilerplate — where privacy matters or you're offline
2. **Use cloud models** for complex reasoning, large-context analysis, and architectural decisions — where quality matters most

Think of local models as a fast, private first line of assistance, with cloud models as the escalation path.

### Looking ahead

The model landscape is moving fast. A few trends that matter for local coding:

- **Quantization improvements** (GGUF, GPTQ) are making larger models fit in less RAM with minimal quality loss
- **Speculative decoding** and other inference optimizations are improving speed on consumer hardware
- **Context window expansion** — newer small models are shipping with 32K-128K context natively
- **Code-specific fine-tuning** keeps improving; coding benchmarks for small models today beat large models from 18 months ago

The gap is closing, but it's still significant. Build your tools to be model-agnostic and context-efficient — today's constraints inform tomorrow's architecture even when hardware catches up.

---

## Technical Stack Summary

| Component | Technology |
|---|---|
| Extension Host | VS Code Extension API (TypeScript) |
| Chat Integration | VS Code Chat Participant API (`@ollama` mention) |
| Fallback UI | Webview (HTML/CSS/JS) with VS Code theme variables |
| LLM Backend | Ollama REST API (`/api/chat`, `/api/tags`) |
| Streaming | AsyncGenerator with NDJSON parsing |
| Bundling | Webpack |
| Models | CodeLlama 7B/13B/34B, DeepSeek-Coder 1.3B/6.7B/33B |
| Security | CSP with nonce-based scripts, no external requests |

---

## Key Takeaways

1. **Use VS Code's Chat Participant API** — don't build a custom webview chat UI. The native chat panel gives you rendering, code actions, variable resolution, and conversation management for free. The integration work is harder, but the result is dramatically better.
2. **Tool calling is the biggest gap** between local and cloud assistants. Don't fake it — prefetch context reliably rather than shipping unreliable real-time tool calls. The two-phase approach (intent detection → prefetch → answer) is the pragmatic sweet spot for small models.
3. **Context window management is the #1 technical challenge** — invest heavily in compaction and relevance ranking
4. **Adaptive performance tuning is essential** — detect the user's hardware and configure accordingly
5. **Model-specific prompting matters more than you'd think** — same prompt, different model, very different results
6. **Onboarding UX can make or break adoption** — users expect "install and go," local models require "install, configure, download, run, then go"
7. **Small models are tools, not replacements** — know their strengths and design your UX around realistic expectations. The sweet spot is routine tasks, code explanation, and offline/private work.

---

*The full source code is available at [github.com/jmcdonald69124/ollama-vscode-local](https://github.com/jmcdonald69124/ollama-vscode-local).*
