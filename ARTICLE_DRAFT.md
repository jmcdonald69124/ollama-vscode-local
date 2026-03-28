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
| UI | Webview (HTML/CSS/JS) with VS Code theme variables |
| LLM Backend | Ollama REST API (`/api/chat`, `/api/tags`) |
| Streaming | AsyncGenerator with NDJSON parsing |
| Bundling | Webpack |
| Models | CodeLlama 7B/13B/34B, DeepSeek-Coder 1.3B/6.7B/33B |
| Security | CSP with nonce-based scripts, no external requests |

---

## Key Takeaways

1. **Local AI assistants are viable** but require significant UX work to handle the setup complexity
2. **Context window management is the #1 technical challenge** — invest heavily in compaction and relevance ranking
3. **Adaptive performance tuning is essential** — detect the user's hardware and configure accordingly
4. **Model-specific prompting matters more than you'd think** — same prompt, different model, very different results
5. **Onboarding UX can make or break adoption** — users expect "install and go," local models require "install, configure, download, run, then go"
6. **Small models are tools, not replacements** — know their strengths and design your UX around realistic expectations

---

*The full source code is available at [github.com/jmcdonald69124/ollama-vscode-local](https://github.com/jmcdonald69124/ollama-vscode-local).*
