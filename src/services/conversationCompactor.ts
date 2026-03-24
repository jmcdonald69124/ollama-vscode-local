import { OllamaChatMessage } from '../types';
import { OllamaService } from './ollamaService';

/**
 * Manages conversation history to fit within the model's context window.
 *
 * Strategies (applied in order):
 * 1. Sliding window: keep the most recent N message pairs
 * 2. Summarization: compress older messages into a summary
 * 3. Code block compression: replace repeated/large code blocks with references
 *
 * CodeLlama context windows:
 * - 7b:  4096 tokens (default), up to 16384 with rope scaling
 * - 13b: 4096 tokens (default), up to 16384
 * - 34b: 4096 tokens (default), up to 16384
 *
 * We reserve ~40% for system prompt + context files, ~10% for the new response,
 * leaving ~50% for conversation history.
 */
export class ConversationCompactor {
  constructor(private readonly ollamaService: OllamaService) {}

  /**
   * Compact conversation history to fit within the token budget.
   * Returns a new messages array that fits within the budget.
   */
  async compact(
    messages: OllamaChatMessage[],
    systemPrompt: string,
    contextWindowSize: number,
    model: string
  ): Promise<OllamaChatMessage[]> {
    const systemTokens = this.estimateTokens(systemPrompt);
    const responseReserve = Math.floor(contextWindowSize * 0.10);
    const historyBudget = contextWindowSize - systemTokens - responseReserve;

    if (historyBudget <= 0) {
      // System prompt alone exceeds budget; just keep the last message
      return messages.length > 0 ? [messages[messages.length - 1]] : [];
    }

    const historyTokens = this.estimateMessagesTokens(messages);

    // If it fits, no compaction needed
    if (historyTokens <= historyBudget) {
      return messages;
    }

    // Strategy 1: Code block compression
    let compacted = this.compressCodeBlocks(messages);
    if (this.estimateMessagesTokens(compacted) <= historyBudget) {
      return compacted;
    }

    // Strategy 2: Sliding window with summary
    compacted = await this.slidingWindowWithSummary(
      compacted,
      historyBudget,
      model
    );

    return compacted;
  }

  /**
   * Compress large code blocks in messages.
   * Replaces duplicate or very large code blocks with summaries.
   */
  private compressCodeBlocks(messages: OllamaChatMessage[]): OllamaChatMessage[] {
    const codeBlockHashes = new Map<string, number>(); // hash -> first occurrence index
    const result: OllamaChatMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const codeBlocks = this.extractCodeBlocks(msg.content);

      if (codeBlocks.length === 0) {
        result.push(msg);
        continue;
      }

      let content = msg.content;

      for (const block of codeBlocks) {
        const hash = this.simpleHash(block.code);

        // Deduplicate: if this exact code appeared before, reference it
        if (codeBlockHashes.has(hash)) {
          content = content.replace(
            block.full,
            `\`\`\`${block.lang}\n// [same code as shown earlier]\n\`\`\``
          );
        }
        // Compress very large code blocks (>80 lines) in older messages
        else if (block.code.split('\n').length > 80 && i < messages.length - 4) {
          const summary = this.summarizeCodeBlock(block.code, block.lang);
          content = content.replace(
            block.full,
            `\`\`\`${block.lang}\n${summary}\n\`\`\``
          );
        }

        codeBlockHashes.set(hash, i);
      }

      result.push({ ...msg, content });
    }

    return result;
  }

  /**
   * Keep recent messages, summarize older ones.
   */
  private async slidingWindowWithSummary(
    messages: OllamaChatMessage[],
    tokenBudget: number,
    model: string
  ): Promise<OllamaChatMessage[]> {
    // Always keep the last 6 messages (3 exchange pairs)
    const recentCount = Math.min(6, messages.length);
    const recent = messages.slice(-recentCount);
    const recentTokens = this.estimateMessagesTokens(recent);

    const older = messages.slice(0, -recentCount);

    if (older.length === 0) {
      // Truncate recent messages if still over budget
      return this.truncateMessages(recent, tokenBudget);
    }

    const summaryBudget = tokenBudget - recentTokens;

    if (summaryBudget < 100) {
      // No room for summary, just keep recent
      return this.truncateMessages(recent, tokenBudget);
    }

    // Try to summarize older messages using the model
    const summary = await this.generateSummary(older, summaryBudget, model);

    if (summary) {
      const summaryMessage: OllamaChatMessage = {
        role: 'assistant',
        content: `[Previous conversation summary]\n${summary}`,
      };
      return [summaryMessage, ...recent];
    }

    // Fallback: extractive summary (no model call)
    const extractiveSummary = this.extractiveSummary(older, summaryBudget);
    if (extractiveSummary) {
      const summaryMessage: OllamaChatMessage = {
        role: 'assistant',
        content: `[Previous conversation summary]\n${extractiveSummary}`,
      };
      return [summaryMessage, ...recent];
    }

    return this.truncateMessages(recent, tokenBudget);
  }

  /**
   * Use the model to generate a conversation summary.
   */
  private async generateSummary(
    messages: OllamaChatMessage[],
    tokenBudget: number,
    model: string
  ): Promise<string | null> {
    try {
      const conversationText = messages
        .map(m => `${m.role}: ${m.content.substring(0, 500)}`)
        .join('\n\n');

      const maxChars = Math.min(tokenBudget * 4, 2000);

      const summaryPrompt: OllamaChatMessage[] = [
        {
          role: 'system',
          content: 'Summarize this conversation concisely, preserving key decisions, code references, and context. Keep it under ' + Math.floor(maxChars / 4) + ' words.',
        },
        {
          role: 'user',
          content: `Summarize this conversation:\n\n${conversationText}`,
        },
      ];

      let summary = '';
      for await (const chunk of this.ollamaService.chatStream(
        summaryPrompt,
        model,
        { temperature: 0.3, num_ctx: 2048 }
      )) {
        summary += chunk;
        if (summary.length > maxChars) { break; }
      }

      return summary.substring(0, maxChars);
    } catch {
      return null;
    }
  }

  /**
   * Extractive summary without model call:
   * Keep the first user question and key decisions from each exchange.
   */
  private extractiveSummary(
    messages: OllamaChatMessage[],
    tokenBudget: number
  ): string | null {
    const charBudget = tokenBudget * 4;
    const summaryParts: string[] = [];
    let totalChars = 0;

    for (const msg of messages) {
      if (totalChars >= charBudget) { break; }

      let extract: string;
      if (msg.role === 'user') {
        // Keep user questions (first 200 chars)
        extract = `Q: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`;
      } else {
        // Keep first sentence of assistant responses + any code language mentions
        const firstSentence = msg.content.split(/[.!?\n]/)[0].substring(0, 150);
        const codeBlocks = this.extractCodeBlocks(msg.content);
        const langs = codeBlocks.map(b => b.lang).filter(Boolean).join(', ');
        extract = `A: ${firstSentence}${langs ? ` [code: ${langs}]` : ''}`;
      }

      if (totalChars + extract.length > charBudget) { break; }
      summaryParts.push(extract);
      totalChars += extract.length;
    }

    return summaryParts.length > 0 ? summaryParts.join('\n') : null;
  }

  /**
   * Last resort: truncate individual messages to fit budget.
   */
  private truncateMessages(
    messages: OllamaChatMessage[],
    tokenBudget: number
  ): OllamaChatMessage[] {
    const result: OllamaChatMessage[] = [];
    let remaining = tokenBudget;

    // Work backwards from most recent
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const tokens = this.estimateTokens(msg.content);

      if (tokens <= remaining) {
        result.unshift(msg);
        remaining -= tokens;
      } else if (remaining > 100) {
        // Truncate this message to fit
        const charBudget = remaining * 4;
        result.unshift({
          ...msg,
          content: msg.content.substring(0, charBudget) + '\n... (earlier content truncated)',
        });
        break;
      } else {
        break;
      }
    }

    return result;
  }

  private extractCodeBlocks(content: string): { full: string; lang: string; code: string }[] {
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    const blocks: { full: string; lang: string; code: string }[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
      blocks.push({ full: match[0], lang: match[1], code: match[2] });
    }
    return blocks;
  }

  private summarizeCodeBlock(code: string, lang: string): string {
    const lines = code.split('\n');
    const summary: string[] = [];

    // Keep imports
    for (const line of lines.slice(0, 10)) {
      if (line.match(/^(import |from |require\(|use |#include)/)) {
        summary.push(line);
      }
    }

    // Keep function/class signatures
    for (const line of lines) {
      if (line.match(/^(export )?(function|class|interface|type|const|def |fn |func |struct )/)) {
        summary.push(line);
      }
    }

    summary.push(`// ... (${lines.length} lines total)`);
    return summary.join('\n');
  }

  private simpleHash(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private estimateMessagesTokens(messages: OllamaChatMessage[]): number {
    return messages.reduce((sum, m) => sum + this.estimateTokens(m.content) + 4, 0);
  }
}
