# Pull AI Models

This extension supports two excellent coding models. You can install one or both.

## CodeLlama (Recommended for General Use)

Meta's CodeLlama is built on Llama 2 and optimized for code. It's the best choice if you need:
- **Broad language support** across Python, JavaScript, TypeScript, Java, C++, and many more
- **Extensive documentation** and community resources
- **Well-rounded performance** for code completion, explanation, and generation

```bash
# Pull CodeLlama (default ~3.8GB)
ollama pull codellama

# Or pull a specific size
ollama pull codellama:7b     # 3.8GB - Fast, good for most tasks
ollama pull codellama:13b    # 7.4GB - Better quality
ollama pull codellama:34b    # 19GB  - Best quality, needs more RAM
```

## DeepSeek-Coder (Best Benchmark Performance)

DeepSeek-Coder achieves top scores on coding benchmarks. Choose this if you need:
- **Top performance** on code generation and completion benchmarks
- **Excellent support** for Chinese programming contexts and documentation
- **Strong multi-language** code understanding

```bash
# Pull DeepSeek-Coder (default ~776MB for 1.3b)
ollama pull deepseek-coder

# Or pull a specific size
ollama pull deepseek-coder:1.3b   # 776MB  - Lightweight and fast
ollama pull deepseek-coder:6.7b   # 3.8GB  - Good balance
ollama pull deepseek-coder:33b    # 19GB   - Maximum quality
```

## Which Model Should I Choose?

| Feature | CodeLlama | DeepSeek-Coder |
|---------|-----------|----------------|
| Language breadth | Excellent | Very Good |
| Benchmark scores | Very Good | Excellent |
| Chinese code contexts | Good | Excellent |
| Community & docs | Excellent | Good |
| Smallest size | 3.8GB (7b) | 776MB (1.3b) |

**Tip:** Start with the smaller model variants for faster responses, then upgrade if you need better quality.

## Verify Models

After pulling, verify your models are available:

```bash
ollama list
```
