import * as vscode from 'vscode';
import * as path from 'path';

export interface CodingStyle {
  indentation: 'tabs' | 'spaces-2' | 'spaces-4' | 'mixed';
  namingConventions: {
    variables: string;
    functions: string;
    classes: string;
    files: string;
  };
  patterns: string[];
  importStyle: string | null;
  errorHandling: string | null;
  commentStyle: string | null;
  lineEndings: 'lf' | 'crlf' | 'mixed';
  maxLineLength: number | null;
  trailingSemicolons: boolean | null;
  quoteStyle: 'single' | 'double' | 'backtick' | 'mixed' | null;
}

export class StyleAnalyzer {
  private cachedStyle: CodingStyle | null = null;
  private cacheTime = 0;
  private readonly CACHE_TTL = 60000; // 1 minute

  async analyze(contextFileUris: string[]): Promise<CodingStyle> {
    if (this.cachedStyle && Date.now() - this.cacheTime < this.CACHE_TTL) {
      return this.cachedStyle;
    }

    const style: CodingStyle = {
      indentation: 'spaces-2',
      namingConventions: {
        variables: 'unknown',
        functions: 'unknown',
        classes: 'unknown',
        files: 'unknown',
      },
      patterns: [],
      importStyle: null,
      errorHandling: null,
      commentStyle: null,
      lineEndings: 'lf',
      maxLineLength: null,
      trailingSemicolons: null,
      quoteStyle: null,
    };

    // Sample up to 5 source files for analysis
    const filesToAnalyze = contextFileUris.slice(0, 5);
    const samples: string[] = [];

    for (const uriStr of filesToAnalyze) {
      try {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.parse(uriStr)
        );
        samples.push(doc.getText());
      } catch {
        // skip
      }
    }

    // If no context files, try to find some source files automatically
    if (samples.length === 0) {
      const autoFiles = await vscode.workspace.findFiles(
        '**/*.{ts,js,py,go,rs,java,tsx,jsx}',
        '{**/node_modules/**,**/dist/**,**/build/**,**/.git/**}',
        5
      );
      for (const fileUri of autoFiles) {
        try {
          const doc = await vscode.workspace.openTextDocument(fileUri);
          samples.push(doc.getText());
        } catch {
          // skip
        }
      }
    }

    if (samples.length === 0) {
      this.cachedStyle = style;
      this.cacheTime = Date.now();
      return style;
    }

    this.analyzeIndentation(samples, style);
    this.analyzeNaming(samples, style);
    this.analyzeImports(samples, style);
    this.analyzeErrorHandling(samples, style);
    this.analyzeQuotesAndSemicolons(samples, style);
    this.analyzePatterns(samples, style);
    this.analyzeLineEndings(samples, style);

    this.cachedStyle = style;
    this.cacheTime = Date.now();
    return style;
  }

  private analyzeIndentation(samples: string[], style: CodingStyle): void {
    let tabCount = 0;
    let space2Count = 0;
    let space4Count = 0;

    for (const code of samples) {
      const lines = code.split('\n');
      for (const line of lines) {
        if (line.startsWith('\t')) { tabCount++; }
        else if (line.startsWith('    ') && !line.startsWith('      ')) { space4Count++; }
        else if (line.startsWith('  ') && !line.startsWith('    ')) { space2Count++; }
      }
    }

    const total = tabCount + space2Count + space4Count;
    if (total === 0) { return; }

    if (tabCount > total * 0.6) { style.indentation = 'tabs'; }
    else if (space4Count > space2Count) { style.indentation = 'spaces-4'; }
    else if (space2Count > space4Count) { style.indentation = 'spaces-2'; }
    else { style.indentation = 'mixed'; }
  }

  private analyzeNaming(samples: string[], style: CodingStyle): void {
    const combined = samples.join('\n');

    // Variable naming: look for const/let/var declarations
    const varDecls = combined.match(/(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g) || [];
    const varNames = varDecls.map(d => d.replace(/(?:const|let|var)\s+/, ''));

    if (varNames.length > 0) {
      const camelCase = varNames.filter(n => /^[a-z][a-zA-Z0-9]*$/.test(n));
      const snakeCase = varNames.filter(n => /^[a-z][a-z0-9_]*$/.test(n) && n.includes('_'));
      if (camelCase.length > snakeCase.length) {
        style.namingConventions.variables = 'camelCase';
      } else if (snakeCase.length > camelCase.length) {
        style.namingConventions.variables = 'snake_case';
      }
    }

    // Function naming
    const funcDecls = combined.match(/(?:function|def|fn|func)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g) || [];
    const funcNames = funcDecls.map(d => d.replace(/(?:function|def|fn|func)\s+/, ''));

    if (funcNames.length > 0) {
      const camelCase = funcNames.filter(n => /^[a-z][a-zA-Z0-9]*$/.test(n));
      const snakeCase = funcNames.filter(n => /^[a-z][a-z0-9_]*$/.test(n) && n.includes('_'));
      if (camelCase.length > snakeCase.length) {
        style.namingConventions.functions = 'camelCase';
      } else if (snakeCase.length > camelCase.length) {
        style.namingConventions.functions = 'snake_case';
      }
    }

    // Class naming
    const classDecls = combined.match(/class\s+([A-Z][a-zA-Z0-9]*)/g) || [];
    if (classDecls.length > 0) {
      style.namingConventions.classes = 'PascalCase';
    }

    // File naming - check workspace files
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      // Infer from the files we analyzed
      const fileNames = samples.length > 0 ? [] : []; // We don't have filenames here, set from context
      style.namingConventions.files = 'unknown';
    }
  }

  private analyzeImports(samples: string[], style: CodingStyle): void {
    const combined = samples.join('\n');

    if (combined.includes('import ') && combined.includes(' from ')) {
      if (combined.includes("import type")) {
        style.importStyle = 'ES modules with type imports';
      } else {
        style.importStyle = 'ES modules';
      }
    } else if (combined.includes('require(')) {
      style.importStyle = 'CommonJS require';
    } else if (combined.match(/^from\s+\S+\s+import/m)) {
      style.importStyle = 'Python imports';
    } else if (combined.match(/^import\s+\(/m)) {
      style.importStyle = 'Go imports';
    } else if (combined.match(/^use\s+/m)) {
      style.importStyle = 'Rust use';
    }
  }

  private analyzeErrorHandling(samples: string[], style: CodingStyle): void {
    const combined = samples.join('\n');

    const tryCatch = (combined.match(/try\s*\{/g) || []).length;
    const promiseCatch = (combined.match(/\.catch\(/g) || []).length;
    const ifErr = (combined.match(/if\s*\(\s*err/g) || []).length;
    const resultPattern = (combined.match(/Result<|Ok\(|Err\(/g) || []).length;
    const throwPattern = (combined.match(/throw\s+new/g) || []).length;

    const max = Math.max(tryCatch, promiseCatch, ifErr, resultPattern);
    if (max === 0) { return; }

    if (tryCatch === max) {
      style.errorHandling = throwPattern > 0
        ? 'try/catch with thrown errors'
        : 'try/catch blocks';
    } else if (promiseCatch === max) {
      style.errorHandling = 'Promise .catch() chains';
    } else if (ifErr === max) {
      style.errorHandling = 'Go-style error checking (if err != nil)';
    } else if (resultPattern === max) {
      style.errorHandling = 'Rust Result<T, E> pattern';
    }
  }

  private analyzeQuotesAndSemicolons(samples: string[], style: CodingStyle): void {
    const combined = samples.join('\n');

    // Quote style
    const singleQuotes = (combined.match(/'/g) || []).length;
    const doubleQuotes = (combined.match(/"/g) || []).length;
    const backticks = (combined.match(/`/g) || []).length;

    if (singleQuotes > doubleQuotes * 1.5) {
      style.quoteStyle = 'single';
    } else if (doubleQuotes > singleQuotes * 1.5) {
      style.quoteStyle = 'double';
    } else if (singleQuotes > 0 || doubleQuotes > 0) {
      style.quoteStyle = 'mixed';
    }

    // Trailing semicolons (JS/TS specific)
    const lines = combined.split('\n').filter(l => l.trim().length > 0);
    const stmtLines = lines.filter(l => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('{') &&
             !t.startsWith('}') && !t.startsWith('import') && !t.startsWith('export') &&
             t.length > 3;
    });

    if (stmtLines.length > 10) {
      const withSemi = stmtLines.filter(l => l.trim().endsWith(';'));
      const ratio = withSemi.length / stmtLines.length;
      if (ratio > 0.6) { style.trailingSemicolons = true; }
      else if (ratio < 0.2) { style.trailingSemicolons = false; }
    }
  }

  private analyzePatterns(samples: string[], style: CodingStyle): void {
    const combined = samples.join('\n');

    // Detect common patterns
    if (combined.includes('async ') && combined.includes('await ')) {
      style.patterns.push('async/await');
    }
    if (combined.match(/=>\s*\{/g) && (combined.match(/=>\s*\{/g) || []).length > 3) {
      style.patterns.push('arrow functions');
    }
    if (combined.includes('interface ') || combined.includes('type ')) {
      style.patterns.push('TypeScript types/interfaces');
    }
    if (combined.includes('export default')) {
      style.patterns.push('default exports');
    }
    if (combined.includes('export {') || combined.includes('export const') || combined.includes('export function')) {
      style.patterns.push('named exports');
    }
    if (combined.includes('@decorator') || combined.match(/@\w+\(/)) {
      style.patterns.push('decorators');
    }
    if (combined.includes('useState') || combined.includes('useEffect')) {
      style.patterns.push('React hooks');
    }
    if (combined.includes('.pipe(') || combined.includes('.subscribe(')) {
      style.patterns.push('RxJS observables');
    }
    if (combined.includes('describe(') && combined.includes('it(')) {
      style.patterns.push('BDD-style tests (describe/it)');
    }
    if (combined.includes('test(') && combined.includes('expect(')) {
      style.patterns.push('test/expect style tests');
    }
  }

  private analyzeLineEndings(samples: string[], style: CodingStyle): void {
    let lf = 0;
    let crlf = 0;
    for (const code of samples) {
      crlf += (code.match(/\r\n/g) || []).length;
      lf += (code.match(/(?<!\r)\n/g) || []).length;
    }
    if (crlf > lf) { style.lineEndings = 'crlf'; }
    else if (lf > crlf) { style.lineEndings = 'lf'; }
    else { style.lineEndings = 'mixed'; }
  }

  formatForPrompt(): string {
    if (!this.cachedStyle) { return ''; }
    const s = this.cachedStyle;
    const lines: string[] = ['## Coding Style Guide (detected from codebase)'];

    lines.push(`- **Indentation**: ${s.indentation}`);

    const naming: string[] = [];
    if (s.namingConventions.variables !== 'unknown') {
      naming.push(`variables: ${s.namingConventions.variables}`);
    }
    if (s.namingConventions.functions !== 'unknown') {
      naming.push(`functions: ${s.namingConventions.functions}`);
    }
    if (s.namingConventions.classes !== 'unknown') {
      naming.push(`classes: ${s.namingConventions.classes}`);
    }
    if (naming.length > 0) {
      lines.push(`- **Naming**: ${naming.join(', ')}`);
    }

    if (s.quoteStyle && s.quoteStyle !== 'mixed') {
      lines.push(`- **Quotes**: ${s.quoteStyle} quotes preferred`);
    }
    if (s.trailingSemicolons !== null) {
      lines.push(`- **Semicolons**: ${s.trailingSemicolons ? 'required' : 'omitted (no-semi style)'}`);
    }
    if (s.importStyle) {
      lines.push(`- **Imports**: ${s.importStyle}`);
    }
    if (s.errorHandling) {
      lines.push(`- **Error Handling**: ${s.errorHandling}`);
    }
    if (s.patterns.length > 0) {
      lines.push(`- **Patterns**: ${s.patterns.join(', ')}`);
    }

    lines.push('');
    lines.push('Follow these conventions when generating code. Match the existing codebase style exactly.');

    return lines.join('\n');
  }
}
