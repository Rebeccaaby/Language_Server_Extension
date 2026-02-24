import {
    createConnection,
    TextDocuments,
    Diagnostic,
    DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    InitializeResult,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    HoverParams,
    SignatureHelpParams,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import * as https from 'https';
import * as winston from 'winston'; // For structured logging
// import * as dotenv from 'dotenv';
// dotenv.config(); 

// Create a connection to the VSCode client
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Environment Variables
const HUGGINGFACE_API_URL = process.env.HUGGINGFACE_API_URL
const HUGGINGFACE_API_PATH = process.env.HUGGINGFACE_API_PATH
const HUGGINGFACE_API_KEY =  process.env.HUGGINGFACE_API_KEY // API key from environment variable


// Setup logger
const logger = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});

// Listen for document changes
documents.listen(connection);

// When the server starts, send a message to the output console
connection.onInitialize((params: InitializeParams): InitializeResult => {
    logger.info('Language server initialized with Hugging Face API');
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: { resolveProvider: true },
            documentFormattingProvider: true,
            hoverProvider: true,
            signatureHelpProvider: { triggerCharacters: ['(', ','] },
            definitionProvider: true,
        },
        serverInfo: {
            name: "ptyhon-language-server",
            version: "0.0.1",
        },
    };
});

// Function to call Hugging Face Inference API
async function callHuggingFaceAPI(prompt: string, maxTokens: number = 100): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!HUGGINGFACE_API_KEY) {
            reject(new Error('Hugging Face API Key is missing'));
            return;
        }

        const requestData = JSON.stringify({
            inputs: prompt,
            parameters: {
                max_new_tokens: maxTokens,
                return_full_text: false,
                do_sample: true,
                temperature: 0.3,
                top_p: 0.95,
            }
        });

        const options = {
            hostname: HUGGINGFACE_API_URL,
            path: HUGGINGFACE_API_PATH,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode !== 200) {
                    logger.error(`API request failed with status: ${res.statusCode}`);
                    logger.error(`Response: ${data}`);
                    resolve(""); // Return empty string on error to avoid breaking
                    return;
                }

                try {
                    const parsedData = JSON.parse(data);
                    if (parsedData.generated_text) {
                        resolve(parsedData.generated_text);
                    } else if (Array.isArray(parsedData) && parsedData.length > 0 && parsedData[0].generated_text) {
                        resolve(parsedData[0].generated_text);
                    } else {
                        logger.warn("Unexpected response format:", parsedData);
                        resolve(""); // Empty response
                    }
                } catch (error) {
                    logger.error("Error parsing API response:", error);
                    resolve(""); // Return empty string on parse error
                }
            });
        });

        req.on('error', (error) => {
            logger.error("Error calling Hugging Face API:", error);
            reject(error);
        });

        req.setTimeout(5000, () => {
            logger.error("API request timed out");
            reject(new Error('Request timed out'));
        });

        req.write(requestData);
        req.end();
    });
}

// Handle completion requests
connection.onCompletion(async (textDocumentPosition: TextDocumentPositionParams) => {
    logger.info('Completion requested at position:', textDocumentPosition.position);
  
    const document = documents.get(textDocumentPosition.textDocument.uri);
    const position = textDocumentPosition.position;
  
    if (!document) {
        logger.warn('Document not found');
        return [];
    }
  
    const text = document.getText();
    const lines = text.split('\n');
    const currentLine = lines[position.line];
    
    const startLine = Math.max(0, position.line - 5);
    const contextLines = lines.slice(startLine, position.line + 1);
    const context = contextLines.join('\n');
    
    try {
        const completions = await getAICompletion(context, currentLine);
        return completions;
    } catch (error) {
        logger.error('Error getting completions:', error);
        return [];
    }
});

// Function to get AI completion using Hugging Face
async function getAICompletion(context: string, currentLine: string): Promise<CompletionItem[]> {
    try {
        const prompt = `
                        You are an intelligent and helpful Python coding assistant.

                        ### Context
                        Here is the recent Python code context:
                        ${context}

                        ### Current Line
                        The user is typing:
                        ${currentLine}

                        ### Objective
                        Predict the next line(s) of valid Python code the user is likely to write. Your suggestions should be clean, executable, and contextually relevant.

                        ### Response Format
                        Return up to 3 suggestions, each numbered. Do not repeat the current line.

                        1.`.trim();
        

        const completionText = await callHuggingFaceAPI(prompt, 150);
        
        const completionItems: CompletionItem[] = [];
        
        const suggestions = completionText.split(/\d+\./).filter(s => s.trim().length > 0);
        
        if (suggestions.length === 0 && completionText.trim().length > 0) {
            completionItems.push({
                label: completionText.trim(),
                kind: CompletionItemKind.Text,
                sortText: '00000',
                insertText: completionText.trim(),
            });
        } else {
            suggestions.forEach((suggestion, index) => {
                const cleanSuggestion = suggestion.trim();
                if (cleanSuggestion) {
                    completionItems.push({
                        label: cleanSuggestion,
                        kind: CompletionItemKind.Text,
                        sortText: String(index).padStart(5, '0'),
                        insertText: cleanSuggestion,
                    });
                }
            });
        }
        
        return completionItems;
    } catch (error) {
        logger.error('Error getting AI completions:', error);
        return [];
    }
}

// Completion resolution with Hugging Face
connection.onCompletionResolve(async (item: CompletionItem) => {
    try {
        const prompt = `
                        You are a Python documentation assistant.
                        
                        ### Task
                        Write a short but informative docstring for the following code or expression. Use a style consistent with Python's built-in documentation.
                        
                        ### Code
                        "${item.label}"
                        
                        ### Response Format
                        <summary line>\n<detailed explanation, if applicable>
                        `.trim();
        
        
        const docText = await callHuggingFaceAPI(prompt, 100);
        
        const lines = docText.split('\n');
        
        if (lines.length > 0) {
            item.detail = lines[0].trim();
            item.documentation = lines.slice(1).join('\n').trim() || lines[0].trim();
        }
        
        return item;
    } catch (error) {
        logger.error('Error getting completion details:', error);
        return item;
    }
});

// Signature help with Hugging Face
connection.onSignatureHelp(async (params: SignatureHelpParams) => {
    const document = documents.get(params.textDocument.uri);
    const position = params.position;
    
    if (!document) return null;

    const text = document.getText();
    const lines = text.split('\n');
    const currentLine = lines[position.line];
    
    let functionCallStart = currentLine.substring(0, position.character).lastIndexOf('(');
    if (functionCallStart === -1) return null;
    
    let functionName = '';
    let i = functionCallStart - 1;
    while (i >= 0 && /[\w\._]/.test(currentLine[i])) {
        functionName = currentLine[i] + functionName;
        i--;
    }
    
    try {
        const prompt = `
                        You are a Python API assistant.
                        
                        ### Task
                        Provide the function signature (name and parameters) for the following Python function.
                        
                        ### Function
                        "${functionName}"
                        
                        ### Response Format
                        <function_signature>
                        `.trim();
        
        const signatureText = await callHuggingFaceAPI(prompt, 100);
        
        let signature = signatureText.trim();
        let documentation = "No documentation available.";
        
        const parameterList: Array<{label: string, documentation: string}> = [];
        const paramMatch = signature.match(/\((.*?)\)/);
        
        if (paramMatch && paramMatch[1]) {
            const params = paramMatch[1].split(',');
            params.forEach((param, index) => {
                parameterList.push({
                    label: param.trim(),
                    documentation: `Parameter ${index + 1}` 
                });
            });
        }
        
        return {
            signatures: [{
                label: signature,
                documentation: documentation,
                parameters: parameterList
            }],
            activeSignature: 0,
            activeParameter: getCurrentParameterIndex(currentLine, position.character)
        };
    } catch (error) {
        logger.error('Error getting signature help:', error);
        return null;
    }
});

// Helper function to determine which parameter is currently being typed
function getCurrentParameterIndex(line: string, position: number): number {
    const textToCursor = line.substring(0, position);
    const openParenIndex = textToCursor.lastIndexOf('(');
    
    if (openParenIndex === -1) return 0;
    
    const relevantText = textToCursor.substring(openParenIndex + 1);
    let paramCount = 0;
    let nestedLevel = 0;
    
    for (const char of relevantText) {
        if (char === '(') nestedLevel++;
        else if (char === ')') nestedLevel--;
        else if (char === ',' && nestedLevel === 0) paramCount++;
    }
    
    return paramCount;
}

// For the hover handler
connection.onHover(async (params: HoverParams) => {
    const document = documents.get(params.textDocument.uri);
    const position = params.position;

    if (!document) {
        logger.warn('Document not found for hover');
        return null;
    }

    const text = document.getText();
    const lines = text.split('\n');
    
    if (position.line >= lines.length) {
        logger.warn('Invalid line position for hover');
        return null;
    }
    
    const line = lines[position.line];
    
    if (position.character >= line.length) {
        logger.warn('Position character beyond line length');
        return null;
    }
    
    const wordRange = getWordRangeAtPosition(line, position.character);
    if (!wordRange) {
        logger.warn('No word at position for hover');
        return null;
    }
    
    const word = line.substring(wordRange.start, wordRange.end);
    
    if (!word || word.trim().length === 0) {
        logger.warn('Empty word at position');
        return null;
    }
    
    logger.info(`Getting hover info for word: '${word}' in line: '${line}'`);
    
    try {
        const prompt = `
                    You are a helpful AI assistant specialized in Python programming.
                    
                    ### Task
                    Explain what the following Python token or function does in one or two concise sentences. Assume the user is hovering over it in their IDE.
                    
                    ### Code
                    "${word}"
                    
                    ### Context
                    "${line}"
                    
                    ### Response Format
                    Respond with a brief, technical explanation formatted in Markdown.
                    `.trim();
        
        const hoverText = await callHuggingFaceAPI(prompt, 100);
        
        return {
            contents: {
                kind: 'markdown',
                value: hoverText.trim() || `No information available for '${word}'`
            },
        };
    } catch (error) {
        logger.error("Error fetching hover text:", error);
        return null;
    }
});

// Helper function to get the word range at position
function getWordRangeAtPosition(line: string, position: number): { start: number, end: number } | null {
    if (!line || position < 0 || position >= line.length) return null;
    
    if (!/[\w\d\._]/.test(line[position])) return null;
    
    let start = position;
    let end = position + 1;
    
    while (start > 0 && /[\w\d\._]/.test(line[start - 1])) start--;
    
    while (end < line.length && /[\w\d\._]/.test(line[end])) end++;
    
    if (start === end || end <= start) return null;
    
    return { start, end };
}

// Start the server
connection.listen();
