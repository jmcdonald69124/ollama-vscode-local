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
    vscode.postMessage({ type: 'openSettings' });
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

    // Create assistant message placeholder
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

    addMessageToUI(
      'error',
      'Error: ' + error + '\n\nMake sure Ollama is running and the model is pulled.'
    );

    currentAssistantEl = null;
    currentAssistantContent = '';
    scrollToBottom();
  }

  function addMessageToUI(role, content) {
    if (welcomeMessage) {
      welcomeMessage.style.display = 'none';
    }

    const messageEl = document.createElement('div');
    messageEl.className = 'message ' + role;

    const icons = { user: '\u{1F464}', assistant: '\u{1F916}', error: '\u26A0\uFE0F' };
    const labels = { user: 'You', assistant: 'Assistant', error: 'Error' };

    messageEl.innerHTML = `
      <div class="message-header">
        <span class="role-icon">${icons[role] || ''}</span>
        <span>${labels[role] || role}</span>
      </div>
      <div class="message-content">${
        role === 'assistant' ? '' : escapeHtml(content)
      }</div>
    `;

    if (role !== 'assistant') {
      const contentEl = messageEl.querySelector('.message-content');
      contentEl.innerHTML = renderMarkdown(content);
    }

    messagesContainer.appendChild(messageEl);
    scrollToBottom();
    return messageEl;
  }

  function restoreSession(session) {
    // Clear messages
    messagesContainer.innerHTML = '';

    if (!session || session.messages.length === 0) {
      messagesContainer.innerHTML = `
        <div id="welcome-message" class="welcome">
          <h2>Ollama Chat</h2>
          <p>Your local AI coding assistant. Ask questions about your code, generate snippets, or get explanations.</p>
          <div class="welcome-hints">
            <p><strong>Quick tips:</strong></p>
            <ul>
              <li>Right-click code in the editor to ask about it</li>
              <li>Add context files for codebase-aware responses</li>
              <li>Use the model selector to switch between CodeLlama and DeepSeek-Coder</li>
            </ul>
          </div>
        </div>
      `;
      return;
    }

    for (const msg of session.messages) {
      if (msg.role === 'system') continue;
      addMessageToUI(msg.role, msg.content);
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
      item.innerHTML = `
        <span title="${escapeHtml(file.uri)}">${escapeHtml(file.relativePath)}</span>
        <button class="remove-btn" title="Remove">\u00D7</button>
      `;
      item.querySelector('.remove-btn').addEventListener('click', () => {
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

      // Headers
      if (line.startsWith('### ')) {
        html += '<h3>' + renderInline(line.slice(4)) + '</h3>';
      } else if (line.startsWith('## ')) {
        html += '<h2>' + renderInline(line.slice(3)) + '</h2>';
      } else if (line.startsWith('# ')) {
        html += '<h1>' + renderInline(line.slice(2)) + '</h1>';
      }
      // Unordered list
      else if (line.match(/^[\s]*[-*]\s/)) {
        html += '<li>' + renderInline(line.replace(/^[\s]*[-*]\s/, '')) + '</li>';
      }
      // Ordered list
      else if (line.match(/^[\s]*\d+\.\s/)) {
        html += '<li>' + renderInline(line.replace(/^[\s]*\d+\.\s/, '')) + '</li>';
      }
      // Horizontal rule
      else if (line.match(/^---+$/)) {
        html += '<hr>';
      }
      // Empty line
      else if (line.trim() === '') {
        html += '<br>';
      }
      // Paragraph
      else {
        html += '<p>' + renderInline(line) + '</p>';
      }
    }

    // Handle unclosed code block (streaming)
    if (inCodeBlock) {
      html += renderCodeBlock(codeContent, codeLang);
    }

    return html;
  }

  function renderInline(text) {
    let result = escapeHtml(text);
    // Bold
    result = result.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italic
    result = result.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Inline code
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Links
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

    return `
      <div class="code-block-wrapper">
        <div class="code-block-header">
          <span>${escapeHtml(langLabel)}</span>
          <div class="code-block-actions">
            <button class="code-action-btn" onclick="copyCode('${id}')">Copy</button>
            <button class="code-action-btn" onclick="insertCode('${id}', '${escapeHtml(langLabel)}')">Insert</button>
          </div>
        </div>
        <pre><code id="${id}">${escapedCode}</code></pre>
      </div>
    `;
  }

  // Global functions for code block buttons
  window.copyCode = function (id) {
    const codeEl = document.getElementById(id);
    if (codeEl) {
      navigator.clipboard.writeText(codeEl.textContent || '');
      // Brief visual feedback
      const btn = codeEl.closest('.code-block-wrapper').querySelector('.code-action-btn');
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = original;
      }, 1500);
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
