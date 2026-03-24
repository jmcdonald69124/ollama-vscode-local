import * as vscode from 'vscode';
import { ChatViewProvider } from '../providers/chatViewProvider';

export function registerChatCommands(
  context: vscode.ExtensionContext,
  chatProvider: ChatViewProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ollamaChat.newChat', () => {
      chatProvider.newChat();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ollamaChat.clearChat', async () => {
      const answer = await vscode.window.showWarningMessage(
        'Clear all chat history?',
        { modal: true },
        'Clear'
      );
      if (answer === 'Clear') {
        chatProvider.newChat();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ollamaChat.askAboutSelection',
      (selectedText?: string, languageId?: string) => {
        const editor = vscode.window.activeTextEditor;
        const text =
          selectedText || (editor ? editor.document.getText(editor.selection) : '');
        const lang =
          languageId || (editor ? editor.document.languageId : 'text');

        if (!text) {
          vscode.window.showWarningMessage(
            'Please select some code first.'
          );
          return;
        }

        const prompt = `I have the following ${lang} code. Can you help me understand and improve it?\n\n\`\`\`${lang}\n${text}\n\`\`\``;

        vscode.commands
          .executeCommand('ollamaChat.chatView.focus')
          .then(() => {
            chatProvider.sendPrompt(prompt);
          });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ollamaChat.explainCode',
      (selectedText?: string, languageId?: string) => {
        const editor = vscode.window.activeTextEditor;
        const text =
          selectedText || (editor ? editor.document.getText(editor.selection) : '');
        const lang =
          languageId || (editor ? editor.document.languageId : 'text');

        if (!text) {
          vscode.window.showWarningMessage(
            'Please select some code first.'
          );
          return;
        }

        const prompt = `Please explain the following ${lang} code in detail. What does it do, and how does it work?\n\n\`\`\`${lang}\n${text}\n\`\`\``;

        vscode.commands
          .executeCommand('ollamaChat.chatView.focus')
          .then(() => {
            chatProvider.sendPrompt(prompt);
          });
      }
    )
  );
}
