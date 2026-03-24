import * as vscode from 'vscode';
import * as os from 'os';
import { OllamaService } from './ollamaService';

export interface SystemProfile {
  totalRamGB: number;
  freeRamGB: number;
  cpuCores: number;
  cpuModel: string;
  platform: string;
  arch: string;
  gpuDetected: boolean;
  gpuInfo: string | null;
  performanceTier: 'low' | 'medium' | 'high';
}

export interface ModelRecommendation {
  modelTag: string;
  displayName: string;
  sizeGB: number;
  quantization: string;
  ramRequired: number;
  description: string;
  recommended: boolean;
}

export interface OllamaParams {
  num_ctx: number;
  num_thread: number;
  num_gpu: number;
  num_batch: number;
  low_vram: boolean;
  keep_alive: string;
}

/**
 * Detects system resources and recommends optimal configuration
 * for running Ollama on resource-constrained machines.
 */
export class PerformanceTuner {
  private cachedProfile: SystemProfile | null = null;

  /**
   * Profile the system and determine performance tier.
   */
  async profileSystem(): Promise<SystemProfile> {
    if (this.cachedProfile) { return this.cachedProfile; }

    const totalRamGB = os.totalmem() / (1024 ** 3);
    const freeRamGB = os.freemem() / (1024 ** 3);
    const cpuCores = os.cpus().length;
    const cpuModel = os.cpus()[0]?.model || 'unknown';
    const platform = os.platform();
    const arch = os.arch();

    // GPU detection heuristic
    const { gpuDetected, gpuInfo } = await this.detectGpu();

    // Determine performance tier
    let performanceTier: 'low' | 'medium' | 'high';
    if (totalRamGB < 6 || (cpuCores < 4 && !gpuDetected)) {
      performanceTier = 'low';
    } else if (totalRamGB < 12 || (!gpuDetected && cpuCores < 8)) {
      performanceTier = 'medium';
    } else {
      performanceTier = 'high';
    }

    this.cachedProfile = {
      totalRamGB: Math.round(totalRamGB * 10) / 10,
      freeRamGB: Math.round(freeRamGB * 10) / 10,
      cpuCores,
      cpuModel,
      platform,
      arch,
      gpuDetected,
      gpuInfo,
      performanceTier,
    };

    return this.cachedProfile;
  }

  /**
   * Get recommended Ollama parameters based on system profile.
   */
  getOptimalParams(profile?: SystemProfile): OllamaParams {
    const p = profile || this.cachedProfile;
    if (!p) {
      return this.getDefaultParams();
    }

    switch (p.performanceTier) {
      case 'low':
        return {
          num_ctx: 2048,
          num_thread: Math.max(2, Math.floor(p.cpuCores * 0.5)),
          num_gpu: p.gpuDetected ? 1 : 0,
          num_batch: 256,
          low_vram: true,
          keep_alive: '5m',  // Free memory after 5 min idle
        };
      case 'medium':
        return {
          num_ctx: 4096,
          num_thread: Math.max(4, Math.floor(p.cpuCores * 0.75)),
          num_gpu: p.gpuDetected ? 20 : 0,
          num_batch: 512,
          low_vram: p.totalRamGB < 10,
          keep_alive: '10m',
        };
      case 'high':
        return {
          num_ctx: 8192,
          num_thread: Math.max(4, p.cpuCores - 2),
          num_gpu: p.gpuDetected ? 99 : 0, // all layers
          num_batch: 1024,
          low_vram: false,
          keep_alive: '30m',
        };
    }
  }

  /**
   * Get model recommendations based on available RAM.
   */
  getModelRecommendations(profile?: SystemProfile): ModelRecommendation[] {
    const p = profile || this.cachedProfile;
    const ram = p?.totalRamGB || 8;

    const all: ModelRecommendation[] = [
      // DeepSeek-Coder variants (smallest first)
      {
        modelTag: 'deepseek-coder:1.3b',
        displayName: 'DeepSeek-Coder 1.3B',
        sizeGB: 0.8,
        quantization: 'Q4_0 (default)',
        ramRequired: 2,
        description: 'Ultra-lightweight. Fast responses, good for autocomplete and simple tasks.',
        recommended: false,
      },
      {
        modelTag: 'deepseek-coder:6.7b',
        displayName: 'DeepSeek-Coder 6.7B',
        sizeGB: 3.8,
        quantization: 'Q4_0 (default)',
        ramRequired: 5,
        description: 'Good balance of speed and quality. Recommended for 8GB machines.',
        recommended: false,
      },
      {
        modelTag: 'deepseek-coder:6.7b-instruct-q8_0',
        displayName: 'DeepSeek-Coder 6.7B (Q8)',
        sizeGB: 7.2,
        quantization: 'Q8_0 (high quality)',
        ramRequired: 9,
        description: 'Higher quality quantization. Better code generation accuracy.',
        recommended: false,
      },
      {
        modelTag: 'deepseek-coder:33b',
        displayName: 'DeepSeek-Coder 33B',
        sizeGB: 19,
        quantization: 'Q4_0 (default)',
        ramRequired: 22,
        description: 'Maximum quality. Requires 32GB+ RAM or strong GPU.',
        recommended: false,
      },

      // CodeLlama variants
      {
        modelTag: 'codellama:7b-code',
        displayName: 'CodeLlama 7B Code',
        sizeGB: 3.8,
        quantization: 'Q4_0 (default)',
        ramRequired: 5,
        description: 'Optimized for code completion. Good all-round performance.',
        recommended: false,
      },
      {
        modelTag: 'codellama:7b-instruct',
        displayName: 'CodeLlama 7B Instruct',
        sizeGB: 3.8,
        quantization: 'Q4_0 (default)',
        ramRequired: 5,
        description: 'Optimized for chat/instructions. Best for conversation.',
        recommended: false,
      },
      {
        modelTag: 'codellama:13b-instruct',
        displayName: 'CodeLlama 13B Instruct',
        sizeGB: 7.4,
        quantization: 'Q4_0 (default)',
        ramRequired: 10,
        description: 'Better quality than 7B. Good for 16GB machines.',
        recommended: false,
      },
      {
        modelTag: 'codellama:34b-instruct',
        displayName: 'CodeLlama 34B Instruct',
        sizeGB: 19,
        quantization: 'Q4_0 (default)',
        ramRequired: 22,
        description: 'Best CodeLlama quality. Requires 32GB+ RAM.',
        recommended: false,
      },
    ];

    // Mark recommendations based on RAM
    for (const model of all) {
      // A model is recommended if it fits in ~60% of total RAM
      // (leaving room for OS + VS Code + other apps)
      model.recommended = model.ramRequired <= ram * 0.6;
    }

    // Annotate ones that can't run
    return all.map(m => ({
      ...m,
      description: m.ramRequired > ram
        ? `${m.description} [WARNING: May not fit in ${Math.round(ram)}GB RAM]`
        : m.description,
    }));
  }

  /**
   * Get the single best model for this system.
   */
  getBestModel(profile?: SystemProfile): ModelRecommendation {
    const recs = this.getModelRecommendations(profile);
    const viable = recs.filter(m => m.recommended);

    if (viable.length === 0) {
      // Even the smallest model is too big — still recommend the smallest
      return recs[0];
    }

    // Pick the largest viable model (best quality that fits)
    return viable[viable.length - 1];
  }

  /**
   * Show a notification if the system appears resource-constrained.
   */
  async showResourceAdvice(): Promise<void> {
    const profile = await this.profileSystem();
    const best = this.getBestModel(profile);

    if (profile.performanceTier === 'low') {
      const action = await vscode.window.showWarningMessage(
        `Your system has ${profile.totalRamGB}GB RAM. For best performance, we recommend ${best.displayName} (${best.sizeGB}GB). Larger models may be slow or cause swapping.`,
        'View Recommendations',
        'Configure Settings',
        'Dismiss'
      );

      if (action === 'View Recommendations') {
        this.showRecommendationsQuickPick(profile);
      } else if (action === 'Configure Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'ollamaChat');
      }
    }
  }

  /**
   * Show an interactive quick pick with model recommendations.
   */
  async showRecommendationsQuickPick(profile?: SystemProfile): Promise<string | undefined> {
    const p = profile || await this.profileSystem();
    const recs = this.getModelRecommendations(p);

    const items = recs.map(m => ({
      label: `${m.recommended ? '$(pass)' : '$(warning)'} ${m.displayName}`,
      description: `${m.sizeGB}GB download, ~${m.ramRequired}GB RAM needed`,
      detail: m.description,
      modelTag: m.modelTag,
      picked: false,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      title: `Model Recommendations (${Math.round(p.totalRamGB)}GB RAM, ${p.cpuCores} cores${p.gpuDetected ? ', GPU detected' : ''})`,
      placeHolder: 'Select a model to pull',
    });

    if (selected) {
      vscode.commands.executeCommand('ollamaChat.pullModel', selected.modelTag);
      return selected.modelTag;
    }
    return undefined;
  }

  /**
   * Format system profile for display.
   */
  formatProfile(profile?: SystemProfile): string {
    const p = profile || this.cachedProfile;
    if (!p) { return 'System profile not available'; }

    const lines = [
      `RAM: ${p.totalRamGB}GB total, ${p.freeRamGB}GB free`,
      `CPU: ${p.cpuCores} cores (${p.cpuModel})`,
      `GPU: ${p.gpuDetected ? p.gpuInfo || 'Detected' : 'Not detected / CPU-only'}`,
      `Platform: ${p.platform} ${p.arch}`,
      `Performance Tier: ${p.performanceTier.toUpperCase()}`,
    ];
    return lines.join('\n');
  }

  private async detectGpu(): Promise<{ gpuDetected: boolean; gpuInfo: string | null }> {
    // Ollama handles GPU detection internally, but we can heuristic-check
    // for common GPU indicators
    try {
      const platform = os.platform();

      if (platform === 'darwin') {
        // macOS: Apple Silicon has unified memory with GPU
        const arch = os.arch();
        if (arch === 'arm64') {
          return { gpuDetected: true, gpuInfo: 'Apple Silicon (Metal)' };
        }
      }

      // For Linux/Windows, we can check environment hints
      // CUDA_VISIBLE_DEVICES or NVIDIA env vars
      if (process.env.CUDA_VISIBLE_DEVICES !== undefined ||
          process.env.NVIDIA_VISIBLE_DEVICES !== undefined) {
        return { gpuDetected: true, gpuInfo: 'NVIDIA GPU (CUDA)' };
      }

      if (process.env.ROCM_HOME || process.env.HSA_OVERRIDE_GFX_VERSION) {
        return { gpuDetected: true, gpuInfo: 'AMD GPU (ROCm)' };
      }

      // Check if total RAM > 16GB on arm64 linux (likely has iGPU)
      if (platform === 'linux' && os.arch() === 'arm64' && os.totalmem() > 8 * 1024 ** 3) {
        return { gpuDetected: true, gpuInfo: 'ARM GPU (possible)' };
      }

      return { gpuDetected: false, gpuInfo: null };
    } catch {
      return { gpuDetected: false, gpuInfo: null };
    }
  }

  private getDefaultParams(): OllamaParams {
    return {
      num_ctx: 4096,
      num_thread: Math.max(4, Math.floor(os.cpus().length * 0.75)),
      num_gpu: 0,
      num_batch: 512,
      low_vram: false,
      keep_alive: '10m',
    };
  }
}
