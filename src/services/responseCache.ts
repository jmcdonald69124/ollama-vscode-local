import * as vscode from 'vscode';

interface CacheEntry {
  response: string;
  model: string;
  timestamp: number;
  hitCount: number;
}

/**
 * Caches LLM responses to avoid redundant Ollama calls.
 *
 * Strategies:
 * - Exact match: identical query + same context files hash
 * - Similarity match: queries that differ only by whitespace/punctuation
 * - TTL expiration: entries expire after configurable duration
 * - LRU eviction: oldest/least-used entries removed when cache is full
 * - Memory-bounded: limits total cache size in characters
 */
export class ResponseCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly maxTotalChars: number;
  private totalChars = 0;

  constructor(options?: {
    maxEntries?: number;
    ttlMinutes?: number;
    maxTotalChars?: number;
  }) {
    this.maxEntries = options?.maxEntries || 50;
    this.ttlMs = (options?.ttlMinutes || 30) * 60 * 1000;
    this.maxTotalChars = options?.maxTotalChars || 500_000; // ~500KB
  }

  /**
   * Look up a cached response for the given query.
   */
  get(query: string, model: string, contextHash: string): string | null {
    const key = this.buildKey(query, model, contextHash);
    const entry = this.cache.get(key);

    if (!entry) {
      // Try normalized match
      const normalizedKey = this.buildKey(this.normalize(query), model, contextHash);
      const normalizedEntry = this.cache.get(normalizedKey);
      if (normalizedEntry && !this.isExpired(normalizedEntry)) {
        normalizedEntry.hitCount++;
        return normalizedEntry.response;
      }
      return null;
    }

    if (this.isExpired(entry)) {
      this.totalChars -= entry.response.length;
      this.cache.delete(key);
      return null;
    }

    entry.hitCount++;
    return entry.response;
  }

  /**
   * Store a response in the cache.
   */
  set(query: string, model: string, contextHash: string, response: string): void {
    // Don't cache very short or very long responses
    if (response.length < 20 || response.length > 50_000) { return; }
    // Don't cache error responses
    if (response.startsWith('Error:') || response.startsWith('I apologize')) { return; }

    this.evictIfNeeded(response.length);

    const key = this.buildKey(query, model, contextHash);
    const normalizedKey = this.buildKey(this.normalize(query), model, contextHash);

    const entry: CacheEntry = {
      response,
      model,
      timestamp: Date.now(),
      hitCount: 0,
    };

    this.cache.set(key, entry);
    this.totalChars += response.length;

    // Also index by normalized form if different
    if (key !== normalizedKey && !this.cache.has(normalizedKey)) {
      this.cache.set(normalizedKey, entry);
      // Don't double-count chars since it's the same entry object
    }
  }

  /**
   * Generate a hash of the context files for cache keying.
   */
  hashContext(fileUris: string[]): string {
    const sorted = [...fileUris].sort();
    let hash = 0;
    const str = sorted.join('|');
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
    this.totalChars = 0;
  }

  /**
   * Get cache statistics.
   */
  getStats(): { entries: number; totalChars: number; maxEntries: number } {
    return {
      entries: this.cache.size,
      totalChars: this.totalChars,
      maxEntries: this.maxEntries,
    };
  }

  private buildKey(query: string, model: string, contextHash: string): string {
    return `${model}:${contextHash}:${query}`;
  }

  private normalize(query: string): string {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.ttlMs;
  }

  private evictIfNeeded(newChars: number): void {
    // Evict expired entries first
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.totalChars -= entry.response.length;
        this.cache.delete(key);
      }
    }

    // Evict by LRU if still over limits
    while (
      (this.cache.size >= this.maxEntries || this.totalChars + newChars > this.maxTotalChars) &&
      this.cache.size > 0
    ) {
      // Find entry with lowest hitCount, then oldest
      let worstKey: string | null = null;
      let worstScore = Infinity;

      for (const [key, entry] of this.cache) {
        const score = entry.hitCount * 1000 + (entry.timestamp / 1000);
        if (score < worstScore) {
          worstScore = score;
          worstKey = key;
        }
      }

      if (worstKey) {
        const entry = this.cache.get(worstKey)!;
        this.totalChars -= entry.response.length;
        this.cache.delete(worstKey);
      } else {
        break;
      }
    }
  }
}
