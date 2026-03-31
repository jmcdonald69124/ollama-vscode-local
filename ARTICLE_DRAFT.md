# Building a Local AI Coding Assistant: VS Code + Ollama + Small Language Models

## Why Build This (And Why You Probably Shouldn't)

The awkward part first: **this is not the best way for most people to interact with an AI coding assistant.** GitHub Copilot, Claude, ChatGPT — they're better. The models are bigger, the context windows are massive, tool calling actually works, and you don't have to install three separate things before you can ask a question about your code.

So why build it?

Because sometimes you're on a plane. Or behind a corporate firewall. Or in a country with unreliable internet. Or you just don't want proprietary code leaving your machine. Or because you want to understand how these tools actually work under the hood instead of just consuming an API.

This project started as a learning exercise: how hard is it to replicate the Copilot Chat experience entirely locally, using Ollama and small open-source models? The answer is "harder than expected, and the result is worse than hoped, but the process teaches a lot about how AI-assisted coding tools actually work."

Full source: [github.com/jmcdonald69124/ollama-vscode-local](https://github.com/jmcdonald69124/ollama-vscode-local).

---

## What Got Built

An open-source VS Code extension (~5,300 lines of TypeScript, JavaScript, and CSS) that connects to Ollama running on localhost, providing a chat sidebar and a Chat Participant (`@ollama`) that works in VS Code's native chat panel. Context-aware code assistance, streaming responses, project detection, style analysis — the whole nine yards. All running on your laptop with zero cloud dependency.

The architecture:

```
VS Code Extension
├── Webview UI (HTML/CSS/JS chat sidebar)
├── Chat Participant Provider (@ollama in VS Code's chat panel)
├── Language Model Provider (registers Ollama models with VS Code)
├── ChatViewProvider (orchestrates the sidebar experience)
├── OllamaService (REST API client, NDJSON streaming)
├── ContextService (workspace file management)
├── ProjectDetector (auto-detect language/framework)
├── StyleAnalyzer (detect coding conventions)
├── PromptEngine (model-specific prompt templates)
├── RelevanceRanker (smart context file scoring)
├── ConversationCompactor (context window management)
├── PerformanceTuner (system profiling + adaptive params)
└── ResponseCache (LRU cache with similarity matching)
```

Every one of those is a real, functional service — no stubs. Whether they're all *necessary* is a different question. More on that below.

---

## The Uncomfortable Truth: You Need VS Code's Proposed APIs

Here's where the reality check starts. If you want your local model to feel like a first-class citizen in VS Code — showing up in the native chat panel alongside Copilot, appearing in the model picker, responding to `@ollama` mentions — you need to use VS Code's **proposed APIs.** And that comes with real friction.

### What "Proposed API" Actually Means

VS Code has a staging system for new APIs. Before an API graduates to "stable" (available to all extensions on any VS Code install), it lives in "proposed" status. Proposed APIs work, but they come with strings attached:

1. You declare them in your `package.json`: `"enabledApiProposals": ["chatProvider"]`
2. You download a separate `.d.ts` type definition file (in this case, `vscode.proposed.chatProvider.d.ts`) so TypeScript knows the API exists
3. Your extension **will only run in VS Code Insiders** or in development mode (`F5` debug launch)

That last point is the killer. You cannot publish an extension using proposed APIs to the VS Code Marketplace for regular VS Code users. Stable VS Code will simply refuse to activate it.

### What This Means In Practice

This extension requires `"engines": { "vscode": "^1.100.0" }` and uses the `chatProvider` proposed API. This enables registering a `LanguageModelChatProvider` — the interface that lets Ollama models show up in VS Code's model picker and respond through the native chat infrastructure. Without it, the extension would be limited to a standalone webview sidebar that feels like a completely separate app bolted onto VS Code.

The `vscode.proposed.chatProvider.d.ts` file isn't a "patch" to VS Code itself — it's just TypeScript type declarations that tell the compiler these APIs exist. But you *do* need VS Code Insiders (or the debug host) to actually run the extension. Regular VS Code won't load it.

**This is the biggest practical barrier for end users.** You're asking someone to:
1. Install VS Code Insiders (not regular VS Code)
2. Install Ollama
3. Pull a model (multi-GB download)
4. *Then* install and use the extension

That's a lot of steps for most people. The extension includes a walkthrough and an onboarding checklist that gates the chat input until everything is ready, but the reality is — if the goal is "a convenient AI coding assistant," this isn't it. The convenience story belongs to cloud-based tools. This project is for a specific set of people with specific constraints (offline, private, educational), and it's important to be upfront about that.

### The Chat Participant API vs. Custom Webview: Both Paths

The extension ships both paths:

**Path 1: Custom Webview Sidebar** — A full HTML/CSS/JS chat interface that works regardless of API availability. Message bubbles, streaming, code blocks with copy/insert buttons, a context file drawer, connection status. About ~2,000 lines of UI code plus the backend orchestration.

**Path 2: Chat Participant API** — Registers `@ollama` in VS Code's native chat panel with three slash commands: `/explain`, `/fix`, `/tests`. Users type in the same chat box where they'd talk to Copilot. Gets free rendering, code block actions, variable resolution (`#file`, `#selection`), and conversation management from VS Code's chrome.

The Chat Participant path is dramatically better UX — when it works. But it's gated behind the proposed API requirement. So the webview is the fallback for anyone not running Insiders or dev mode.

If VS Code ever stabilizes the `LanguageModelChatProvider` API (letting third-party extensions register as model backends for the native chat), this project becomes significantly more compelling. Until then, it's building for a niche within a niche.

---

## The Language Model Provider: Making Ollama a First-Class VS Code Model

The most interesting architectural piece isn't the chat UI — it's the `LanguageModelChatProvider`. This is the interface that lets your extension tell VS Code: "Hey, I have language models available. Here are their names, here are their capabilities. When you need a response, call me."

```typescript
export function registerLanguageModelProvider(
    context: vscode.ExtensionContext,
    ollamaService: OllamaService
) {
    const provider: vscode.LanguageModelChatProvider = {
        async provideLanguageModelChatInformation() {
            // Query Ollama for installed models
            // Return them as LanguageModelChatInformation objects
            // Tell VS Code which ones support tool calling
        },

        async *provideLanguageModelChatResponse(messages, options, extensions, token) {
            // Convert VS Code message format → Ollama format
            // Stream responses back as LanguageModelTextPart or LanguageModelToolCallPart
        }
    };
}
```

When this works, Ollama models appear in VS Code's model picker. Any extension that uses VS Code's `lm` API to request a language model response could, in theory, use a local Ollama model. The extension becomes infrastructure, not just a chat app.

The extension reports `toolCalling: true` for all models, then lets Ollama and the model sort out whether tool calls actually happen. Optimistic? Yes. But the alternative is maintaining a per-model capability database, and the landscape changes too fast for that.

---

## The Tool Calling Gap: The Elephant in the Chat Room

If you've used Copilot Chat or Claude in VS Code, you've watched the model *do things* — read files across your workspace, run terminal commands, search for symbols, edit code in place. That's not magic; it's **tool calling**. The model outputs structured JSON requests, VS Code executes them, and feeds results back.

This is where local models hit their hardest wall. It's the single biggest gap between local and cloud experiences.

### What Actually Works

The extension passes tool definitions to Ollama's API when models that support function calling are used (Llama 3.1+, some Qwen variants, Mistral). The tool calls come back as structured objects in the streaming response, and get yielded as `LanguageModelToolCallPart` objects to VS Code. The plumbing is there.

### What Doesn't Work (Reliably)

Most 7B-13B models were not trained for tool calling. You ask CodeLlama to call a function and you get:

```
I would suggest reading the file to understand the structure.
Let me look at src/index.ts for you.
```

That's a *description* of wanting to use a tool, not an actual tool call. The model talks about what it would do rather than emitting structured JSON.

Even with models that nominally support tool calling (Llama 3.1, newer Qwen builds), reliability varies wildly. Sometimes you get perfect JSON tool invocations. Sometimes you get malformed JSON with trailing commas. Sometimes the model hallucinates tool names that don't exist. The failure rate is high enough that you can't build a UX that depends on it.

### The Pragmatic Approach

Rather than pretending tool calling works, this extension leans into what local models are actually good at: **answering questions when given the right context upfront.**

The ContextService, RelevanceRanker, ProjectDetector, and StyleAnalyzer do the "tool work" before the model ever sees your query. They gather relevant files automatically — scoring them by keyword overlap, filename mentions, file type affinity — and inject truncated versions into the system prompt. The model gets a pre-assembled context package and just needs to reason about it.

It's less dynamic than real tool calling. You can't say "search the workspace for all files that import Redis" and have the model actually do it. But it's far more reliable than watching a 7B model fail to emit valid JSON 40% of the time.

The tool calling gap is the reason this can't replace Copilot Chat for most workflows. But it's narrowing fast as tool-calling fine-tunes improve. If you're building something like this, implement the tool calling plumbing so you're ready when models catch up, but don't make your UX depend on it.

---

## Pain Point #1: Streaming Responses and the NDJSON Headache

Ollama's `/api/chat` endpoint streams responses as newline-delimited JSON. Each chunk looks like:

```json
{"model":"codellama","message":{"role":"assistant","content":"Hello"},"done":false}
```

Sounds simple. In practice, you're fighting two problems:

**Buffer boundaries don't align with message boundaries.** A single `read()` from the response body might give you one and a half JSON lines, or half of one. Without proper buffer management, you get random `JSON.parse` failures mid-conversation.

```typescript
async *chatStream(messages, model, options) {
    const reader = response.body.getReader();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';  // Keep the incomplete line

        for (const line of lines) {
            if (!line.trim() || line.length > 1_000_000) continue;  // Size limit for safety
            const chunk = JSON.parse(line);
            if (chunk.message?.content) yield chunk.message.content;
        }
    }
}
```

**Streaming into VS Code's Chat Participant has its own quirks.** `response.markdown()` expects coherent markdown fragments. Ollama streams individual tokens — sometimes mid-word, sometimes mid-code-fence. Push too eagerly and the UI flickers. Push too slowly and it feels laggy. The solution: buffer until a natural boundary (newline, 80+ chars) then flush.

---

## Pain Point #2: Context Windows Are Tiny (And It Shows)

This is the elephant in the room that no amount of clever engineering fully solves.

CodeLlama's default context window is 4,096 tokens. DeepSeek-Coder goes up to 16K. Compare that to GPT-4's 128K or Claude's 200K. After the system prompt, project context, style guide, and the first few conversation turns, you're out of room.

The extension uses a multi-strategy conversation compactor that tries everything:

1. **Code block deduplication** — if the same code appears multiple times in history, keep only the latest
2. **Large code block compression** — replace 20+ line blocks with their signatures
3. **Sliding window** — keep only the last 6 messages when history grows
4. **Extractive summarization** — pull key sentences from older messages
5. **Message truncation** — last resort hard-cut

The token budget math: about 40% of the context window goes to the system prompt + context files, 50% to conversation, 10% to the response. That means with a 4K context model, conversation gets ~2,000 tokens. That's about 1,500 words — maybe 3-4 exchanges before the model starts losing track of the discussion.

4K context models feel choppy after 3-4 exchanges. The model forgets constraints, contradicts itself, loses the thread. 16K models are the practical minimum for anything resembling a conversation. If you're trying this, start with a 16K+ context model or accept that you'll be hitting "New Chat" frequently.

---

## Pain Point #3: Your Laptop Is Also Running an OS, a Browser, and VS Code

Running a 7B model requires ~4-8GB of RAM for model weights alone. On an 8GB laptop, that leaves almost nothing for everything else. Fans spin up. VS Code stutters. First-token latency is measured in seconds, not milliseconds.

The extension includes a `PerformanceTuner` that profiles the system and adjusts model parameters automatically:

```
+-------------------+---------------+----------------+-------------+-------------------------------+
| System Tier       | Available RAM | Context Window | CPU Threads | Strategy                      |
+-------------------+---------------+----------------+-------------+-------------------------------+
| Low (<6GB free)   | <6GB          | 1024 tokens    | 2           | low_vram: true, minimal batch |
| Medium (6-12GB)   | 6-12GB        | 2048 tokens    | 4           | Balanced                      |
| High (12GB+)      | 12GB+         | 4096 tokens    | 6           | Full GPU offload if available |
+-------------------+---------------+----------------+-------------+-------------------------------+
```

It detects GPU availability (CUDA, ROCm, Metal) and adjusts `num_gpu` layers accordingly. There's also a "Recommend Models" command that suggests models based on your actual system specs — if you have 4GB free, it'll suggest DeepSeek-Coder 1.3B instead of letting you try to load a 13B model and wonder why everything froze.

This is table-stakes UX for local model tools that most projects skip. If your extension silently lets users load a model that won't fit in RAM, the experience is terrible and they'll blame your extension, not their hardware.

---

## Pain Point #4: Smart Context Without a Cloud Brain

Cloud assistants can ingest entire repos. Local models can't. So the extension includes a relevance ranker that scores which files are most relevant to the current query.

The scoring formula considers:
- **Keyword overlap** — weighted by term rarity (IDF-style)
- **Filename mentions** — "what does chatService do?" boosts `chatService.ts`
- **File type affinity** — TypeScript files score higher for TypeScript questions
- **Core file boost** — config files, entry points, type definitions
- **Active editor boost** — you're probably asking about what you're looking at

When truncating to fit the budget, the ranker keeps imports (dependency context), function/class definitions (structural context), and lines containing query keywords (relevant context). The model sees the skeleton plus the parts that matter, not a random slice.

Is it as good as Copilot's full-repo indexing? No. Does it help? Noticeably. Without it, the model gets random file contents and has to hope for the best.

---

## Pain Point #5: "Just Install the Extension" Is Five Steps

Unlike cloud-based extensions where you install and go, this extension requires:

1. Install VS Code **Insiders** (because proposed APIs)
2. Install **Ollama** (a separate application)
3. Start the Ollama server (`ollama serve`)
4. Pull a model (`ollama pull qwen2.5-coder:7b` — a multi-GB download)
5. Install and activate the extension

If any step is missing, the extension needs to say exactly what's wrong. The onboarding checklist in the chat panel handles this:

```
┌──────────────────────────────────┐
│  Ollama Chat — Setup Required    │
│                                  │
│  ✅ Ollama Installed             │
│  ❌ Ollama Running               │
│     → Start with: ollama serve   │
│  ⚠️  No models pulled            │
│     → Run: ollama pull codellama │
│                                  │
│  [Open Setup Guide] [Check]      │
└──────────────────────────────────┘
```

The input box starts **disabled** until all checks pass. Error messages are contextual — ECONNREFUSED means "Ollama isn't running," 404 means "model not found — pull it," timeout means "model might be too large" with a suggestion to try the Recommend Models command.

This kind of UX work separates "a project that technically works" from "a project someone else could actually use." Five steps to first chat message is a lot. Each one needs hand-holding.

---

## Pain Point #6: Models Are Not Interchangeable

CodeLlama and DeepSeek-Coder respond very differently to identical prompts. CodeLlama likes verbose, structured system prompts with explicit formatting instructions. DeepSeek-Coder works better with concise, direct prompts. Send the wrong style and quality degrades noticeably.

The extension's `PromptEngine` has 8 task types (explain, refactor, generate, debug, test, review, document, general) and separate template sets per model family. Task detection uses keyword matching on the user's query — crude but effective.

The `StyleAnalyzer` reads actual source files to detect indentation, naming conventions, quote style, import patterns, and common idioms (async/await usage, React hooks, error handling patterns). This gets baked into the system prompt so the model generates code that matches the existing style.

It's a small thing that makes a surprisingly big difference. Nothing breaks trust faster than an AI that confidently writes `snake_case` variables in a `camelCase` codebase.

---

## Pain Point #7: The Project Detection Rabbit Hole

For context-aware responses, the model needs to know the stack. The `ProjectDetector` reads config files to auto-detect language (TypeScript, Python, Go, Rust, Java, Kotlin), framework (React, Next.js, Django, FastAPI, Spring Boot, Gin, etc.), test framework, linter, package manager, and build tool.

This information feeds into the system prompt. When someone asks "write a test for this function," the model knows whether to reach for Jest, Pytest, Go's testing package, or Rust's built-in test framework. Without it, you get generic advice that requires manual adaptation.

Results are cached for 5 minutes per workspace — expensive file system reads shouldn't happen on every message.

---

## Security: Taking It Seriously for a Local Tool

You might think "it's all local, what's there to secure?" More than you'd expect.

**Webview XSS:** The chat UI renders model-generated markdown as HTML. Markdown that contains `<script>` tags, `javascript:` URIs in links, or malicious code blocks needs to be sanitized. The extension uses DOM APIs for header construction (no `innerHTML` with user-controlled data), event delegation for code block buttons (no inline `onclick` handlers), and blocks `javascript:`/`data:` URIs in rendered links.

**Content Security Policy:** The webview runs with `default-src 'none'` and nonce-based script/style loading. No external resources can be loaded.

**Input validation:** Messages from the webview to the extension backend validate type and length before processing. Model names are restricted to alphanumeric characters, dashes, dots, and colons (no slashes — path traversal is real).

**Server URL restriction:** OllamaService only connects to localhost (`127.0.0.1`, `::1`). No arbitrary server URLs. Credentials in URLs are stripped.

**Streaming protection:** JSON lines from the Ollama API are size-limited to 1MB each to prevent memory exhaustion from a malicious or misconfigured server response.

Not glamorous work, but skipping it in a tool that renders AI-generated content directly as HTML is asking for trouble.

---

## Honest Thoughts on Small Language Models for Coding

After building all of this — ~5,300 lines of code optimizing the local experience — here's a candid assessment:

### What actually works well

- **Code explanation** — Small models are surprisingly good at this. 7B models can break down complex functions accurately and clearly.
- **Boilerplate generation** — React components, Express routes, CRUD operations, common patterns. These come out clean.
- **Focused code questions** — "What does this regex do?" "How does this async flow work?" With the right context injected, answers are solid.
- **Rubber duck debugging** — Even when suggestions aren't perfect, the act of articulating a problem in a chat interface helps thinking. The AI's response is a bonus.
- **Privacy-sensitive work** — Proprietary code that can't leave the machine. This is the #1 legitimate use case.
- **Offline development** — Planes, trains, rural areas. Your coding assistant keeps working.

### What doesn't work well

- **Cross-file reasoning** — With 4K-16K context, the model just can't hold enough of a codebase to understand how services interact across files. It gives answers about individual files, not systems.
- **Architectural advice** — "How should I restructure this?" requires understanding the whole picture. Small models give generic advice because they can only see a fragment of it.
- **Long conversations** — Even with compaction, conversations degrade noticeably after the context fills. The model starts contradicting itself.
- **Complex edge cases** — Advanced TypeScript generics, complex SQL, async race conditions — small models hallucinate more here.
- **Anything requiring tool calling** — As discussed. The plumbing exists, the model reliability doesn't (yet).

### Who this is actually for

Plainly: **most developers should just use Copilot or Claude Code.** They're better at virtually everything. The models are orders of magnitude more capable. The UX is polished. They have proper tool calling, massive context windows, and professional support.

This project makes sense if:
- You work offline regularly and still want AI assistance
- You're in an environment where code cannot leave the machine (regulated industries, strict IP policies)
- You want to understand how AI coding tools work by building one
- You're experimenting with fine-tuned local models for a specific domain

That's a real audience, but it's a niche one, and it's important to say that clearly rather than pretending a 7B model running on a laptop is competitive with what Anthropic and OpenAI deploy in data centers.

### The sweet spot (if you're going to try it)

**7B-13B models on 16GB+ RAM** with a 16K+ context window is the practical floor. Below that, the model fights back too much. The Qwen-Coder custom Modelfile (tweaked temperature, top_k, system prompt) gets decent results for common tasks, and the Qwen 2.5 Coder builds are noticeably better than what was available a year ago.

The ideal workflow isn't "replace cloud tools" — it's:
1. **Use local models** for routine tasks, explanations, and boilerplate where privacy matters or you're offline
2. **Use cloud models** for complex reasoning, multi-file analysis, and anything that requires a large context window

Local models are a fast, private fallback. Not the primary tool.

### The gap is closing (but it's still big)

Some trends worth watching:
- **Quantization improvements** (GGUF, GPTQ) are fitting bigger models in less RAM
- **Context windows are expanding** — newer small models ship with 32K-128K natively
- **Tool-calling fine-tunes** are getting better (Llama 3.1/3.2, Qwen 2.5)
- **Code-specific models** keep improving; today's small model benchmarks beat large models from 18 months ago

But "the gap is closing" is not "the gap is closed." Build tooling to be model-agnostic and context-efficient. Today's constraints won't last forever, but the architecture patterns developed around them will stay useful.

---

## Technical Stack Summary

```
+---------------------------+--------------------------------------------------------------+
| Component                 | Technology                                                   |
+---------------------------+--------------------------------------------------------------+
| Extension Host            | VS Code Extension API (TypeScript)                           |
| Chat Integration          | VS Code Chat Participant API + custom Webview fallback       |
| Model Integration         | LanguageModelChatProvider (proposed API, VS Code Insiders)   |
| LLM Backend               | Ollama REST API (/api/chat, /api/tags)                       |
| Streaming                 | AsyncGenerator with NDJSON buffered parsing                  |
| Bundling                  | Webpack                                                      |
| Primary Models            | Qwen 2.5 Coder 7B, custom Qwen-Coder Modelfile              |
| Other Tested Models       | CodeLlama 7B/13B, DeepSeek-Coder 1.3B/6.7B                  |
| Security                  | CSP with nonce-based scripts, localhost-only, input validation|
+---------------------------+--------------------------------------------------------------+
```

---

## Key Takeaways

1. **Be honest about the limitations.** This is not the best way for most people to get AI coding assistance. Cloud tools are better. But for offline/private use cases, local models are the *only* option, and that's worth building for.
2. **VS Code's proposed API situation is a real barrier.** The `chatProvider` API makes the experience dramatically better, but it locks you into Insiders-only distribution. Ship a webview fallback if you want anyone to actually use your extension.
3. **Tool calling is the biggest capability gap** between local and cloud. Don't fake it — prefetch context reliably. The plumbing for real tool calling should be there for when models improve, but don't build UX that depends on it today.
4. **Context window management is the #1 technical challenge.** Invest heavily in compaction and relevance ranking. It's the difference between a useful assistant and one that forgets what you said two messages ago.
5. **Adaptive performance tuning is essential.** Detect hardware, recommend appropriate models, gate the experience. Letting users load a 13B model on 8GB RAM without warning is a guaranteed bad first impression.
6. **Model-specific prompting matters more than you'd think.** Same prompt, different model, very different results. Invest in per-model template tuning.
7. **Onboarding UX is the make-or-break.** Five steps to first message is a lot. Hand-hold through every one, and make errors actionable — not just "connection failed" but "Ollama isn't running, here's how to start it."
8. **Build it anyway.** Even if the output is worse than cloud tools, building something like this from scratch teaches more about how AI coding assistants work than any blog post or tutorial — including this one.

---

*Full source code at [github.com/jmcdonald69124/ollama-vscode-local](https://github.com/jmcdonald69124/ollama-vscode-local). PRs welcome, especially for improving tool calling reliability on 7B models.*
