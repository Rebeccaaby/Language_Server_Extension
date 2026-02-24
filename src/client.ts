import * as vscode from 'vscode';
import * as path from 'path';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext) {
  // The server path (language server executable or script)
  const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));

  // Define the server options for LSP
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc }
  };

  // Define client options (capabilities, synchronization)
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'python' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/.py')
    }
  };

  // Create the language client
  client = new LanguageClient(
    'ptyhon-language-server', // The ID of the client (name of the LSP)
    'ptyhon-language-server', // The name of the server
    serverOptions,
    clientOptions
  );

  // Start the client and connect to the server
  client.start();

  // Push the client into the context subscriptions
  context.subscriptions.push(client);
}

export function deactivate() {
  // When the extension is deactivated, stop the client
  if (!client) {
    return undefined;
  }
  console.log('Language server stopped');
  return client.stop();
}
