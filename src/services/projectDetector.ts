import * as vscode from 'vscode';
import * as path from 'path';

export interface ProjectInfo {
  name: string;
  language: string;
  framework: string | null;
  testFramework: string | null;
  linter: string | null;
  packageManager: string | null;
  buildTool: string | null;
  dependencies: string[];
  devDependencies: string[];
  scripts: Record<string, string>;
  projectType: string;
}

export class ProjectDetector {
  private cachedInfo: ProjectInfo | null = null;
  private cacheTime = 0;
  private readonly CACHE_TTL = 30000; // 30 seconds

  async detect(): Promise<ProjectInfo | null> {
    if (this.cachedInfo && Date.now() - this.cacheTime < this.CACHE_TTL) {
      return this.cachedInfo;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }

    const rootUri = workspaceFolders[0].uri;
    const info: ProjectInfo = {
      name: path.basename(rootUri.fsPath),
      language: 'unknown',
      framework: null,
      testFramework: null,
      linter: null,
      packageManager: null,
      buildTool: null,
      dependencies: [],
      devDependencies: [],
      scripts: {},
      projectType: 'unknown',
    };

    // Run detections in parallel
    const [
      nodeResult,
      pythonResult,
      goResult,
      rustResult,
      javaResult,
    ] = await Promise.allSettled([
      this.detectNode(rootUri, info),
      this.detectPython(rootUri, info),
      this.detectGo(rootUri, info),
      this.detectRust(rootUri, info),
      this.detectJava(rootUri, info),
    ]);

    // Detect linter config
    await this.detectLinter(rootUri, info);

    this.cachedInfo = info;
    this.cacheTime = Date.now();
    return info;
  }

  private async fileExists(uri: vscode.Uri, filename: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(uri, filename));
      return true;
    } catch {
      return false;
    }
  }

  private async readJsonFile(uri: vscode.Uri, filename: string): Promise<any | null> {
    try {
      const fileUri = vscode.Uri.joinPath(uri, filename);
      const content = await vscode.workspace.fs.readFile(fileUri);
      return JSON.parse(Buffer.from(content).toString('utf-8'));
    } catch {
      return null;
    }
  }

  private async readTextFile(uri: vscode.Uri, filename: string): Promise<string | null> {
    try {
      const fileUri = vscode.Uri.joinPath(uri, filename);
      const content = await vscode.workspace.fs.readFile(fileUri);
      return Buffer.from(content).toString('utf-8');
    } catch {
      return null;
    }
  }

  private async detectNode(rootUri: vscode.Uri, info: ProjectInfo): Promise<void> {
    const pkg = await this.readJsonFile(rootUri, 'package.json');
    if (!pkg) { return; }

    info.language = 'javascript';
    info.projectType = 'node';

    // Check for TypeScript
    if (await this.fileExists(rootUri, 'tsconfig.json')) {
      info.language = 'typescript';
    }

    // Package manager
    if (await this.fileExists(rootUri, 'pnpm-lock.yaml')) {
      info.packageManager = 'pnpm';
    } else if (await this.fileExists(rootUri, 'yarn.lock')) {
      info.packageManager = 'yarn';
    } else if (await this.fileExists(rootUri, 'bun.lockb')) {
      info.packageManager = 'bun';
    } else {
      info.packageManager = 'npm';
    }

    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    info.dependencies = Object.keys(pkg.dependencies || {});
    info.devDependencies = Object.keys(pkg.devDependencies || {});
    info.scripts = pkg.scripts || {};

    // Framework detection
    if (allDeps['next']) { info.framework = 'Next.js'; }
    else if (allDeps['nuxt']) { info.framework = 'Nuxt'; }
    else if (allDeps['@angular/core']) { info.framework = 'Angular'; }
    else if (allDeps['svelte'] || allDeps['@sveltejs/kit']) { info.framework = 'Svelte'; }
    else if (allDeps['vue']) { info.framework = 'Vue'; }
    else if (allDeps['react']) { info.framework = allDeps['react-native'] ? 'React Native' : 'React'; }
    else if (allDeps['express']) { info.framework = 'Express'; }
    else if (allDeps['fastify']) { info.framework = 'Fastify'; }
    else if (allDeps['nestjs'] || allDeps['@nestjs/core']) { info.framework = 'NestJS'; }
    else if (allDeps['hono']) { info.framework = 'Hono'; }
    else if (allDeps['electron']) { info.framework = 'Electron'; }

    // Test framework
    if (allDeps['vitest']) { info.testFramework = 'Vitest'; }
    else if (allDeps['jest']) { info.testFramework = 'Jest'; }
    else if (allDeps['mocha']) { info.testFramework = 'Mocha'; }
    else if (allDeps['ava']) { info.testFramework = 'Ava'; }
    else if (allDeps['playwright'] || allDeps['@playwright/test']) { info.testFramework = 'Playwright'; }
    else if (allDeps['cypress']) { info.testFramework = 'Cypress'; }

    // Build tool
    if (allDeps['webpack']) { info.buildTool = 'webpack'; }
    else if (allDeps['vite']) { info.buildTool = 'Vite'; }
    else if (allDeps['esbuild']) { info.buildTool = 'esbuild'; }
    else if (allDeps['rollup']) { info.buildTool = 'Rollup'; }
    else if (allDeps['turbo'] || allDeps['turbopack']) { info.buildTool = 'Turbopack'; }
  }

  private async detectPython(rootUri: vscode.Uri, info: ProjectInfo): Promise<void> {
    const hasRequirements = await this.fileExists(rootUri, 'requirements.txt');
    const hasPyproject = await this.fileExists(rootUri, 'pyproject.toml');
    const hasSetupPy = await this.fileExists(rootUri, 'setup.py');
    const hasPipfile = await this.fileExists(rootUri, 'Pipfile');

    if (!hasRequirements && !hasPyproject && !hasSetupPy && !hasPipfile) { return; }
    if (info.language !== 'unknown') { return; } // Node already detected

    info.language = 'python';
    info.projectType = 'python';

    if (hasPipfile) { info.packageManager = 'pipenv'; }
    else if (hasPyproject) { info.packageManager = 'poetry/pip'; }
    else { info.packageManager = 'pip'; }

    // Read requirements or pyproject for framework detection
    const requirements = await this.readTextFile(rootUri, 'requirements.txt') || '';
    const pyproject = await this.readTextFile(rootUri, 'pyproject.toml') || '';
    const combined = requirements + pyproject;

    if (combined.includes('django')) { info.framework = 'Django'; }
    else if (combined.includes('fastapi')) { info.framework = 'FastAPI'; }
    else if (combined.includes('flask')) { info.framework = 'Flask'; }
    else if (combined.includes('starlette')) { info.framework = 'Starlette'; }
    else if (combined.includes('tornado')) { info.framework = 'Tornado'; }

    if (combined.includes('pytest')) { info.testFramework = 'pytest'; }
    else if (combined.includes('unittest')) { info.testFramework = 'unittest'; }
  }

  private async detectGo(rootUri: vscode.Uri, info: ProjectInfo): Promise<void> {
    const goMod = await this.readTextFile(rootUri, 'go.mod');
    if (!goMod) { return; }
    if (info.language !== 'unknown') { return; }

    info.language = 'go';
    info.projectType = 'go';
    info.packageManager = 'go modules';
    info.testFramework = 'go test';

    if (goMod.includes('github.com/gin-gonic/gin')) { info.framework = 'Gin'; }
    else if (goMod.includes('github.com/gofiber/fiber')) { info.framework = 'Fiber'; }
    else if (goMod.includes('github.com/labstack/echo')) { info.framework = 'Echo'; }
  }

  private async detectRust(rootUri: vscode.Uri, info: ProjectInfo): Promise<void> {
    const cargoToml = await this.readTextFile(rootUri, 'Cargo.toml');
    if (!cargoToml) { return; }
    if (info.language !== 'unknown') { return; }

    info.language = 'rust';
    info.projectType = 'rust';
    info.packageManager = 'cargo';
    info.testFramework = 'cargo test';

    if (cargoToml.includes('actix-web')) { info.framework = 'Actix Web'; }
    else if (cargoToml.includes('axum')) { info.framework = 'Axum'; }
    else if (cargoToml.includes('rocket')) { info.framework = 'Rocket'; }
    else if (cargoToml.includes('tokio')) { info.buildTool = 'Tokio (async runtime)'; }
  }

  private async detectJava(rootUri: vscode.Uri, info: ProjectInfo): Promise<void> {
    const hasPom = await this.fileExists(rootUri, 'pom.xml');
    const hasGradle = await this.fileExists(rootUri, 'build.gradle') ||
                      await this.fileExists(rootUri, 'build.gradle.kts');
    if (!hasPom && !hasGradle) { return; }
    if (info.language !== 'unknown') { return; }

    info.language = 'java';
    info.projectType = 'java';
    info.packageManager = hasPom ? 'Maven' : 'Gradle';
    info.buildTool = hasPom ? 'Maven' : 'Gradle';

    if (await this.fileExists(rootUri, 'src/main/kotlin')) {
      info.language = 'kotlin';
    }

    const buildFile = hasPom
      ? await this.readTextFile(rootUri, 'pom.xml') || ''
      : await this.readTextFile(rootUri, 'build.gradle') ||
        await this.readTextFile(rootUri, 'build.gradle.kts') || '';

    if (buildFile.includes('spring-boot') || buildFile.includes('org.springframework')) {
      info.framework = 'Spring Boot';
    } else if (buildFile.includes('quarkus')) {
      info.framework = 'Quarkus';
    }

    info.testFramework = 'JUnit';
  }

  private async detectLinter(rootUri: vscode.Uri, info: ProjectInfo): Promise<void> {
    if (await this.fileExists(rootUri, '.eslintrc.json') ||
        await this.fileExists(rootUri, '.eslintrc.js') ||
        await this.fileExists(rootUri, '.eslintrc.yml') ||
        await this.fileExists(rootUri, 'eslint.config.js') ||
        await this.fileExists(rootUri, 'eslint.config.mjs')) {
      info.linter = 'ESLint';
    } else if (await this.fileExists(rootUri, '.pylintrc') ||
               await this.fileExists(rootUri, 'setup.cfg')) {
      info.linter = 'Pylint';
    } else if (await this.fileExists(rootUri, '.flake8')) {
      info.linter = 'Flake8';
    } else if (await this.fileExists(rootUri, 'ruff.toml') ||
               await this.fileExists(rootUri, '.ruff.toml')) {
      info.linter = 'Ruff';
    } else if (await this.fileExists(rootUri, '.golangci.yml') ||
               await this.fileExists(rootUri, '.golangci.yaml')) {
      info.linter = 'golangci-lint';
    }

    // Check for formatter
    if (await this.fileExists(rootUri, '.prettierrc') ||
        await this.fileExists(rootUri, '.prettierrc.json') ||
        await this.fileExists(rootUri, 'prettier.config.js')) {
      info.linter = info.linter ? `${info.linter} + Prettier` : 'Prettier';
    }
  }

  formatForPrompt(): string {
    if (!this.cachedInfo) { return ''; }
    const info = this.cachedInfo;
    const lines: string[] = ['## Project Overview'];

    lines.push(`- **Project**: ${info.name}`);
    lines.push(`- **Language**: ${info.language}`);
    if (info.framework) { lines.push(`- **Framework**: ${info.framework}`); }
    if (info.packageManager) { lines.push(`- **Package Manager**: ${info.packageManager}`); }
    if (info.buildTool) { lines.push(`- **Build Tool**: ${info.buildTool}`); }
    if (info.testFramework) { lines.push(`- **Test Framework**: ${info.testFramework}`); }
    if (info.linter) { lines.push(`- **Linter/Formatter**: ${info.linter}`); }

    if (info.dependencies.length > 0) {
      const topDeps = info.dependencies.slice(0, 15);
      lines.push(`- **Key Dependencies**: ${topDeps.join(', ')}${info.dependencies.length > 15 ? ` (+${info.dependencies.length - 15} more)` : ''}`);
    }

    return lines.join('\n');
  }
}
