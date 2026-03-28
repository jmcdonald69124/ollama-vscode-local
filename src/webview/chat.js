(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // DOM elements
  const messagesContainer = document.getElementById('messages');
  const welcomeMessage = document.getElementById('welcome-message');
  const userInput = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const stopBtn = document.getElementById('stop-btn');
  const modelName = document.getElementById('model-name');
  const connectionStatus = document.getElementById('connection-status');
  const contextBtn = document.getElementById('context-btn');
  const contextCount = document.getElementById('context-count');
  const contextDrawer = document.getElementById('context-drawer');
  const contextList = document.getElementById('context-list');
  const addContextBtn = document.getElementById('add-context-btn');
  const newChatBtn = document.getElementById('new-chat-btn');
  const connectionBanner = document.getElementById('connection-banner');
  const retryConnectionBtn = document.getElementById('retry-connection-btn');
  const setupBtn = document.getElementById('setup-btn');

  let isStreaming = false;
  let currentAssistantEl = null;
  let currentAssistantContent = '';
  let contextDrawerOpen = false;
  let isOllamaReady = false; // Track whether Ollama is connected AND model is available

  // Request initial state
  vscode.postMessage({ type: 'requestState' });

  // --- Event listeners ---
  sendBtn.addEventListener('click', sendMessage);
  stopBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'cancelStream' });
  });

  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  userInput.addEventListener('input', autoResize);

  modelName.addEventListener('click', () => {
    vscode.postMessage({ type: 'selectModel' });
  });

  contextBtn.addEventListener('click', () => {
    contextDrawerOpen = !contextDrawerOpen;
    contextDrawer.style.display = contextDrawerOpen ? 'block' : 'none';
  });

  addContextBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'addContextFile' });
  });

  newChatBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'newChat' });
  });

  retryConnectionBtn.addEventListener('click', () => {
    connectionStatus.className = 'status-dot checking';
    vscode.postMessage({ type: 'checkConnection' });
  });

  setupBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'openSetupGuide' });
  });

  // --- Message handler ---
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'streamChunk':
        handleStreamChunk(msg.content);
        break;
      case 'streamEnd':
        handleStreamEnd();
        break;
      case 'streamError':
        handleStreamError(msg.error);
        break;
      case 'modelChanged':
        modelName.textContent = msg.model;
        break;
      case 'contextFilesUpdated':
        updateContextFiles(msg.files);
        break;
      case 'ollamaStatus':
        updateConnectionStatus(msg.connected, msg.models);
        break;
      case 'setupStatus':
        updateSetupStatus(msg.status);
        break;
      case 'restoreState':
        restoreSession(msg.session);
        break;
      case 'addUserMessage':
        addMessageToUI('user', msg.text);
        startStreaming();
        break;
    }
  });

  // --- Functions ---
  function sendMessage() {
    const text = userInput.value.trim();
    if (!text || isStreaming) return;

    // Warn if Ollama isn't ready
    if (!isOllamaReady) {
      addMessageToUI(
        'error',
        'Ollama is not ready. Please complete the setup steps above before chatting.\n\nClick "Open Setup Guide" for step-by-step instructions.'
      );
      return;
    }

    addMessageToUI('user', text);
    userInput.value = '';
    autoResize();
    startStreaming();

    vscode.postMessage({ type: 'sendMessage', text });
  }

  function startStreaming() {
    isStreaming = true;
    sendBtn.style.display = 'none';
    stopBtn.style.display = 'inline-block';
    userInput.disabled = true;

    currentAssistantContent = '';
    currentAssistantEl = addMessageToUI('assistant', '');
    const contentEl = currentAssistantEl.querySelector('.message-content');
    contentEl.innerHTML =
      '<div class="typing-indicator"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';

    scrollToBottom();
  }

  function handleStreamChunk(content) {
    if (!currentAssistantEl) return;
    currentAssistantContent += content;
    const contentEl = currentAssistantEl.querySelector('.message-content');
    contentEl.innerHTML = renderMarkdown(currentAssistantContent);
    scrollToBottom();
  }

  function handleStreamEnd() {
    isStreaming = false;
    sendBtn.style.display = 'inline-block';
    stopBtn.style.display = 'none';
    userInput.disabled = false;
    userInput.focus();

    if (currentAssistantEl && currentAssistantContent) {
      const contentEl = currentAssistantEl.querySelector('.message-content');
      contentEl.innerHTML = renderMarkdown(currentAssistantContent);
    } else if (currentAssistantEl && !currentAssistantContent) {
      currentAssistantEl.remove();
    }

    currentAssistantEl = null;
    currentAssistantContent = '';
    scrollToBottom();
  }

  function handleStreamError(error) {
    isStreaming = false;
    sendBtn.style.display = 'inline-block';
    stopBtn.style.display = 'none';
    userInput.disabled = false;
    userInput.focus();

    if (currentAssistantEl) {
      currentAssistantEl.remove();
    }

    // Provide actionable error messages
    let errorMsg = 'Error: ' + error;

    if (error.includes('ECONNREFUSED') || error.includes('fetch failed') || error.includes('Failed to fetch')) {
      errorMsg += '\n\n**Ollama is not running.** Start it with:\n```bash\nollama serve\n```\nOr download it from https://ollama.ai/download';
    } else if (error.includes('model') && (error.includes('not found') || error.includes('404'))) {
      errorMsg += '\n\n**The selected model is not installed.** Pull it with:\n```bash\nollama pull ' + (modelName.textContent || 'codellama') + '\n```\nOr click the model name above to choose a different one.';
    } else if (error.includes('timeout') || error.includes('Timeout')) {
      errorMsg += '\n\n**The request timed out.** This can happen if:\n- The model is still loading (first request takes longer)\n- Your system doesn\'t have enough RAM for this model\n- Try a smaller model variant (use "Ollama Chat: Recommend Models" command)';
    } else {
      errorMsg += '\n\n**Troubleshooting:**\n1. Check that Ollama is running: `ollama serve`\n2. Check that a model is pulled: `ollama list`\n3. Try the Setup Guide for step-by-step help';
    }

    addMessageToUI('error', errorMsg);

    currentAssistantEl = null;
    currentAssistantContent = '';
    scrollToBottom();
  }

  function addMessageToUI(role, content) {
    // Hide welcome message when chat starts
    const welcome = document.getElementById('welcome-message');
    if (welcome && role !== 'setup') {
      welcome.style.display = 'none';
    }

    const messageEl = document.createElement('div');
    messageEl.className = 'message ' + role;

    const icons = { user: '\u{1F464}', assistant: '\u{1F916}', error: '\u26A0\uFE0F' };
    const labels = { user: 'You', assistant: 'Assistant', error: 'Error' };

    messageEl.innerHTML = [
      '<div class="message-header">',
      '  <span class="role-icon">' + (icons[role] || '') + '</span>',
      '  <span>' + (labels[role] || role) + '</span>',
      '</div>',
      '<div class="message-content"></div>',
    ].join('\n');

    const contentEl = messageEl.querySelector('.message-content');
    contentEl.innerHTML = renderMarkdown(content);

    messagesContainer.appendChild(messageEl);
    scrollToBottom();
    return messageEl;
  }

  function restoreSession(session) {
    messagesContainer.innerHTML = '';

    if (!session || session.messages.length === 0) {
      showWelcomeScreen();
      return;
    }

    for (const msg of session.messages) {
      if (msg.role === 'system') continue;
      addMessageToUI(msg.role, msg.content);
    }
  }

  /**
   * Show the welcome screen with setup requirements prominently displayed.
   */
  function showWelcomeScreen() {
    messagesContainer.innerHTML = [
      '<div id="welcome-message" class="welcome">',
      '  <h2>Ollama Chat</h2>',
      '  <p>Local AI coding assistant — runs entirely on your machine, no internet required.</p>',
      '',
      '  <div class="setup-required">',
      '    <div class="setup-header">',
      '      <span class="setup-icon">\u{1F6E0}\uFE0F</span>',
      '      <strong>Setup Required</strong>',
      '    </div>',
      '    <p class="setup-note">This extension requires <strong>Ollama</strong> to be installed and running locally with at least one coding model downloaded. It does not work out of the box.</p>',
      '',
      '    <div class="setup-steps">',
      '      <div class="setup-step" id="step-ollama">',
      '        <span class="step-status" id="step-ollama-status">\u{25CB}</span>',
      '        <div class="step-content">',
      '          <strong>Step 1: Install Ollama</strong>',
      '          <p>Download from <code>ollama.ai/download</code> (macOS, Linux, Windows)</p>',
      '        </div>',
      '      </div>',
      '',
      '      <div class="setup-step" id="step-running">',
      '        <span class="step-status" id="step-running-status">\u{25CB}</span>',
      '        <div class="step-content">',
      '          <strong>Step 2: Start Ollama</strong>',
      '          <p>Run <code>ollama serve</code> in a terminal (may auto-start on install)</p>',
      '        </div>',
      '      </div>',
      '',
      '      <div class="setup-step" id="step-model">',
      '        <span class="step-status" id="step-model-status">\u{25CB}</span>',
      '        <div class="step-content">',
      '          <strong>Step 3: Pull a coding model</strong>',
      '          <p>Run <code>ollama pull codellama</code> or <code>ollama pull deepseek-coder</code></p>',
      '        </div>',
      '      </div>',
      '    </div>',
      '',
      '    <div class="setup-actions">',
      '      <button class="setup-action-btn" id="welcome-setup-guide-btn">Open Setup Guide</button>',
      '      <button class="setup-action-btn secondary" id="welcome-check-btn">Check Connection</button>',
      '      <button class="setup-action-btn secondary" id="welcome-recommend-btn">Recommend Models</button>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="welcome-hints" id="ready-hints" style="display:none">',
      '    <p><strong>You\'re all set! Quick tips:</strong></p>',
      '    <ul>',
      '      <li>Right-click code in the editor to ask about it</li>',
      '      <li>Add context files for codebase-aware responses</li>',
      '      <li>Use the model selector to switch between CodeLlama and DeepSeek-Coder</li>',
      '    </ul>',
      '  </div>',
      '</div>',
    ].join('\n');

    // Bind welcome screen buttons
    var guideBtn = document.getElementById('welcome-setup-guide-btn');
    if (guideBtn) {
      guideBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'openSetupGuide' });
      });
    }
    var checkBtn = document.getElementById('welcome-check-btn');
    if (checkBtn) {
      checkBtn.addEventListener('click', function () {
        connectionStatus.className = 'status-dot checking';
        vscode.postMessage({ type: 'checkConnection' });
      });
    }
    var recommendBtn = document.getElementById('welcome-recommend-btn');
    if (recommendBtn) {
      recommendBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'recommendModels' });
      });
    }
  }

  /**
   * Update the setup checklist in the welcome screen based on actual status.
   */
  function updateSetupStatus(status) {
    isOllamaReady = status.ollamaRunning && status.selectedModelInstalled;

    // Update input placeholder based on readiness
    if (isOllamaReady) {
      userInput.placeholder = 'Ask a question...';
      userInput.disabled = false;
    } else {
      userInput.placeholder = 'Complete setup above to start chatting...';
    }

    // Update welcome screen step indicators
    var ollamaStatus = document.getElementById('step-ollama-status');
    var runningStatus = document.getElementById('step-running-status');
    var modelStatus = document.getElementById('step-model-status');
    var readyHints = document.getElementById('ready-hints');
    var setupRequired = document.querySelector('.setup-required');

    if (ollamaStatus) {
      ollamaStatus.textContent = status.ollamaRunning ? '\u2705' : '\u274C';
      ollamaStatus.closest('.setup-step').className =
        'setup-step ' + (status.ollamaRunning ? 'done' : 'pending');
    }
    if (runningStatus) {
      runningStatus.textContent = status.ollamaRunning ? '\u2705' : '\u274C';
      runningStatus.closest('.setup-step').className =
        'setup-step ' + (status.ollamaRunning ? 'done' : 'pending');
    }
    if (modelStatus) {
      if (status.selectedModelInstalled) {
        modelStatus.textContent = '\u2705';
        modelStatus.closest('.setup-step').className = 'setup-step done';
      } else if (status.ollamaRunning && status.modelsAvailable.length > 0) {
        // Has some models but not the selected one
        modelStatus.textContent = '\u26A0\uFE0F';
        modelStatus.closest('.setup-step').className = 'setup-step warning';
        var stepContent = modelStatus.closest('.setup-step').querySelector('.step-content p');
        if (stepContent) {
          stepContent.innerHTML =
            'Model <code>' + escapeHtml(status.selectedModel) + '</code> not found. Available: ' +
            status.modelsAvailable.slice(0, 3).map(function(m) { return '<code>' + escapeHtml(m) + '</code>'; }).join(', ') +
            '. Run <code>ollama pull ' + escapeHtml(status.selectedModel) + '</code>';
        }
      } else {
        modelStatus.textContent = '\u274C';
        modelStatus.closest('.setup-step').className = 'setup-step pending';
      }
    }

    // Show/hide ready hints vs setup required
    if (readyHints && setupRequired) {
      if (isOllamaReady) {
        setupRequired.style.display = 'none';
        readyHints.style.display = 'block';
      } else {
        setupRequired.style.display = 'block';
        readyHints.style.display = 'none';
      }
    }
  }

  function updateContextFiles(files) {
    if (files.length > 0) {
      contextCount.textContent = files.length.toString();
      contextCount.style.display = 'inline-block';
    } else {
      contextCount.style.display = 'none';
    }

    contextList.innerHTML = '';
    for (const file of files) {
      const item = document.createElement('div');
      item.className = 'context-item';
      item.innerHTML =
        '<span title="' + escapeHtml(file.uri) + '">' + escapeHtml(file.relativePath) + '</span>' +
        '<button class="remove-btn" title="Remove">\u00D7</button>';
      item.querySelector('.remove-btn').addEventListener('click', function() {
        vscode.postMessage({ type: 'removeContextFile', uri: file.uri });
      });
      contextList.appendChild(item);
    }
  }

  function updateConnectionStatus(connected, models) {
    connectionStatus.className =
      'status-dot ' + (connected ? 'connected' : 'disconnected');
    connectionStatus.title = connected
      ? 'Connected to Ollama' + (models.length ? ': ' + models.join(', ') : '')
      : 'Not connected to Ollama';
    connectionBanner.style.display = connected ? 'none' : 'flex';
  }

  function autoResize() {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 150) + 'px';
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // --- Minimal markdown renderer ---
  function renderMarkdown(text) {
    if (!text) return '';

    let html = '';
    let inCodeBlock = false;
    let codeContent = '';
    let codeLang = '';
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLang = line.slice(3).trim();
          codeContent = '';
        } else {
          html += renderCodeBlock(codeContent, codeLang);
          inCodeBlock = false;
          codeContent = '';
          codeLang = '';
        }
        continue;
      }

      if (inCodeBlock) {
        codeContent += (codeContent ? '\n' : '') + line;
        continue;
      }

      if (line.startsWith('### ')) {
        html += '<h3>' + renderInline(line.slice(4)) + '</h3>';
      } else if (line.startsWith('## ')) {
        html += '<h2>' + renderInline(line.slice(3)) + '</h2>';
      } else if (line.startsWith('# ')) {
        html += '<h1>' + renderInline(line.slice(2)) + '</h1>';
      } else if (line.match(/^[\s]*[-*]\s/)) {
        html += '<li>' + renderInline(line.replace(/^[\s]*[-*]\s/, '')) + '</li>';
      } else if (line.match(/^[\s]*\d+\.\s/)) {
        html += '<li>' + renderInline(line.replace(/^[\s]*\d+\.\s/, '')) + '</li>';
      } else if (line.match(/^---+$/)) {
        html += '<hr>';
      } else if (line.trim() === '') {
        html += '<br>';
      } else {
        html += '<p>' + renderInline(line) + '</p>';
      }
    }

    if (inCodeBlock) {
      html += renderCodeBlock(codeContent, codeLang);
    }

    return html;
  }

  function renderInline(text) {
    let result = escapeHtml(text);
    result = result.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/\*(.*?)\*/g, '<em>$1</em>');
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
    result = result.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" title="$1">$1</a>'
    );
    return result;
  }

  function renderCodeBlock(code, lang) {
    const escapedCode = escapeHtml(code);
    const langLabel = lang || 'text';
    const id = 'code-' + Math.random().toString(36).substring(2, 8);

    return [
      '<div class="code-block-wrapper">',
      '  <div class="code-block-header">',
      '    <span>' + escapeHtml(langLabel) + '</span>',
      '    <div class="code-block-actions">',
      '      <button class="code-action-btn" onclick="copyCode(\'' + id + '\')">Copy</button>',
      '      <button class="code-action-btn" onclick="insertCode(\'' + id + '\', \'' + escapeHtml(langLabel) + '\')">Insert</button>',
      '    </div>',
      '  </div>',
      '  <pre><code id="' + id + '">' + escapedCode + '</code></pre>',
      '</div>',
    ].join('\n');
  }

  window.copyCode = function (id) {
    const codeEl = document.getElementById(id);
    if (codeEl) {
      navigator.clipboard.writeText(codeEl.textContent || '');
      const btn = codeEl.closest('.code-block-wrapper').querySelector('.code-action-btn');
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(function() { btn.textContent = original; }, 1500);
    }
  };

  window.insertCode = function (id, lang) {
    const codeEl = document.getElementById(id);
    if (codeEl) {
      vscode.postMessage({
        type: 'insertCodeToEditor',
        code: codeEl.textContent || '',
        language: lang,
      });
    }
  };
})();
