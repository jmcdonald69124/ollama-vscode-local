import * as vscode from 'vscode';

export class OllamaCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection
  ): vscode.CodeAction[] {
    if (range.isEmpty) {
      return [];
    }

    const selectedText = document.getText(range);
    if (!selectedText.trim()) {
      return [];
    }

    const explainAction = new vscode.CodeAction(
      'Explain with Ollama',
      vscode.CodeActionKind.RefactorRewrite
    );
    explainAction.command = {
      command: 'ollamaChat.explainCode',
      title: 'Explain Code',
      arguments: [selectedText, document.languageId],
    };

    const askAction = new vscode.CodeAction(
      'Ask Ollama about this code',
      vscode.CodeActionKind.RefactorRewrite
    );
    askAction.command = {
      command: 'ollamaChat.askAboutSelection',
      title: 'Ask About Selection',
      arguments: [selectedText, document.languageId],
    };

    return [explainAction, askAction];
  }
}
