import * as vscode from 'vscode';
import * as path from 'path';
import { ContextFile } from '../types';

interface ScoredFile {
  file: ContextFile;
  score: number;
  content: string;
}

/**
 * Ranks context files by relevance to the user's query.
 * Uses keyword matching, file type affinity, and recency signals
 * to prioritize the most useful files within the token budget.
 */
export class RelevanceRanker {
  /**
   * Rank and select the most relevant files for a given query,
   * fitting within the approximate token budget.
   */
  async rankAndSelect(
    files: ContextFile[],
    query: string,
    tokenBudget: number
  ): Promise<string> {
    if (files.length === 0) { return ''; }

    const scored: ScoredFile[] = [];

    for (const file of files) {
      try {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.parse(file.uri)
        );
        const content = doc.getText();
        const score = this.scoreFile(file, content, query);
        scored.push({ file, score, content });
      } catch {
        // File may have been deleted
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Pack files within token budget
    let prompt = '';
    let estimatedTokens = 0;

    for (const { file, content, score } of scored) {
      const fileTokens = this.estimateTokens(content);

      if (estimatedTokens + fileTokens > tokenBudget) {
        // Try to fit a truncated version
        const remainingTokens = tokenBudget - estimatedTokens;
        if (remainingTokens > 200) {
          const truncatedContent = this.smartTruncate(content, remainingTokens, query);
          prompt += this.formatFile(file, truncatedContent, true);
          estimatedTokens += this.estimateTokens(truncatedContent);
        }
        break;
      }

      prompt += this.formatFile(file, content, false);
      estimatedTokens += fileTokens;
    }

    return prompt;
  }

  /**
   * Score a file's relevance to the query.
   */
  private scoreFile(file: ContextFile, content: string, query: string): number {
    let score = 0;
    const queryLower = query.toLowerCase();
    const contentLower = content.toLowerCase();
    const filePath = file.relativePath.toLowerCase();

    // 1. Filename mentioned in query (high signal)
    const fileName = path.basename(file.relativePath, path.extname(file.relativePath)).toLowerCase();
    if (queryLower.includes(fileName)) {
      score += 50;
    }

    // 2. Query keywords found in file content
    const queryWords = this.extractKeywords(query);
    for (const word of queryWords) {
      const count = this.countOccurrences(contentLower, word.toLowerCase());
      if (count > 0) {
        score += Math.min(count * 3, 20); // Cap per-keyword contribution
      }
    }

    // 3. File type affinity based on query
    if (queryLower.match(/\b(test|spec|testing)\b/) && filePath.match(/\.(test|spec)\./)) {
      score += 30;
    }
    if (queryLower.match(/\b(style|css|layout|design)\b/) && filePath.match(/\.(css|scss|less|styled)/)) {
      score += 25;
    }
    if (queryLower.match(/\b(config|setup|settings)\b/) && filePath.match(/(config|settings|setup)/)) {
      score += 25;
    }
    if (queryLower.match(/\b(api|route|endpoint|handler)\b/) && filePath.match(/(route|api|handler|controller)/)) {
      score += 25;
    }
    if (queryLower.match(/\b(model|schema|database|db)\b/) && filePath.match(/(model|schema|entity|migration)/)) {
      score += 25;
    }

    // 4. Core files get a small boost (index, main, app, etc.)
    if (filePath.match(/(index|main|app|server)\./)) {
      score += 10;
    }

    // 5. Shorter files are slightly preferred (more likely to be focused/relevant)
    const lineCount = content.split('\n').length;
    if (lineCount < 100) { score += 5; }
    else if (lineCount > 500) { score -= 5; }

    // 6. Active editor file gets a boost
    const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
    if (activeUri === file.uri) {
      score += 20;
    }

    return score;
  }

  /**
   * Smart truncation: keep the most relevant parts of a file.
   * Prioritizes: imports, class/function definitions, and sections matching query keywords.
   */
  private smartTruncate(content: string, tokenBudget: number, query: string): string {
    const charBudget = tokenBudget * 4; // rough: 1 token ~ 4 chars
    if (content.length <= charBudget) { return content; }

    const lines = content.split('\n');
    const queryWords = this.extractKeywords(query);
    const selectedLines: { index: number; line: string; priority: number }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLower = line.toLowerCase();
      let priority = 0;

      // Imports/requires (always useful for context)
      if (line.match(/^(import |from |require\(|use |#include)/)) {
        priority = 3;
      }
      // Function/class/interface definitions
      else if (line.match(/^(export |public |private |protected )?(function|class|interface|type|const|let|def |fn |func |struct |enum )/)) {
        priority = 4;
      }
      // Lines containing query keywords
      else if (queryWords.some(w => lineLower.includes(w.toLowerCase()))) {
        priority = 5;
      }
      // Closing braces after priority lines
      else if (line.trim() === '}' || line.trim() === '});') {
        // Include if previous line was selected
        priority = 0;
      }

      if (priority > 0) {
        selectedLines.push({ index: i, line, priority });
        // Also include 2 lines of context after definitions
        if (priority >= 4) {
          for (let j = 1; j <= 2 && i + j < lines.length; j++) {
            selectedLines.push({ index: i + j, line: lines[i + j], priority: 1 });
          }
        }
      }
    }

    // Deduplicate and sort by index
    const seen = new Set<number>();
    const unique = selectedLines.filter(l => {
      if (seen.has(l.index)) { return false; }
      seen.add(l.index);
      return true;
    }).sort((a, b) => a.index - b.index);

    // Build truncated content within budget
    let result = '';
    let lastIndex = -1;

    for (const { index, line } of unique) {
      if (result.length + line.length > charBudget - 50) { break; }

      if (lastIndex >= 0 && index > lastIndex + 1) {
        result += '\n  // ... (lines omitted)\n';
      }
      result += line + '\n';
      lastIndex = index;
    }

    if (result.length < charBudget * 0.3) {
      // Fallback: just take the top of the file
      return content.substring(0, charBudget) + '\n// ... (truncated)';
    }

    return result;
  }

  private extractKeywords(query: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
      'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its', 'they',
      'what', 'which', 'who', 'when', 'where', 'why', 'how',
      'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'about',
      'and', 'or', 'but', 'not', 'no', 'if', 'then', 'else',
      'code', 'file', 'function', 'please', 'help', 'want', 'need',
    ]);

    return query
      .split(/[\s,.\-:;!?()[\]{}'"]+/)
      .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()));
  }

  private countOccurrences(text: string, search: string): number {
    let count = 0;
    let pos = 0;
    while ((pos = text.indexOf(search, pos)) !== -1) {
      count++;
      pos += search.length;
    }
    return count;
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token for code
    return Math.ceil(text.length / 4);
  }

  private formatFile(file: ContextFile, content: string, truncated: boolean): string {
    const marker = truncated ? ' (key sections)' : '';
    return `\n--- ${file.relativePath} (${file.language})${marker} ---\n${content}\n--- end ---\n`;
  }
}
