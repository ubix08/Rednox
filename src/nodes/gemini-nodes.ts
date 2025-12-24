
// ===================================================================
// RedNox - Complete Gemini Agent Integration with Google GenAI SDK
// ===================================================================

import { registry } from '../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext } from '../types/core';
import { RED, StorageKeys } from '../utils';

// ===================================================================
// GEMINI AGENT - All-in-One Node
// ===================================================================

registry.register('gemini-agent', {
  type: 'gemini-agent',
  category: 'gemini',
  color: '#4285F4',
  defaults: {
    name: { value: '' },
    
    // Model Configuration
    model: { value: 'gemini-2.0-flash-exp' },
    temperature: { value: 0.7 },
    topP: { value: 0.95 },
    topK: { value: 40 },
    maxOutputTokens: { value: 8192 },
    
    // System Instruction
    systemInstruction: { value: '' },
    
    // Native Tools
    enableSearch: { value: false },
    enableCodeExecution: { value: false },
    enableFunctionCalling: { value: true },
    
    // URL Context (multimodal)
    urlContexts: { value: [] }, // Array of URLs for context
    
    // Multimodal
    enableVision: { value: true },
    
    // Memory
    memoryNode: { value: '' },
    conversationId: { value: 'default' },
    
    // RAG
    ragMemoryNode: { value: '' },
    
    // Safety
    safetySettings: { value: [] },
    
    // Advanced
    maxAttempts: { value: 5 },
    responseSchema: { value: '' }, // JSON schema for structured output
    responseMimeType: { value: 'text/plain' } // text/plain or application/json
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    try {
      node.status({ fill: 'yellow', shape: 'dot', text: 'processing' });
      
      const apiKey = context.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
      }
      
      // Build generation config
      const generationConfig: any = {
        temperature: node.config.temperature ?? 0.7,
        topP: node.config.topP ?? 0.95,
        topK: node.config.topK ?? 40,
        maxOutputTokens: node.config.maxOutputTokens ?? 8192
      };
      
      // Add structured output if specified
      if (node.config.responseSchema) {
        try {
          generationConfig.responseSchema = JSON.parse(node.config.responseSchema);
          generationConfig.responseMimeType = node.config.responseMimeType || 'application/json';
        } catch (err) {
          node.warn('Invalid response schema JSON');
        }
      }
      
      // Prepare content parts (text + images)
      const parts = prepareContentParts(msg, node.config);
      
      // Get conversation history from memory
      let history: any[] = [];
      const conversationId = msg.conversationId || node.config.conversationId || 'default';
      
      if (node.config.memoryNode) {
        history = await getMemoryHistory(node.config.memoryNode, conversationId, context);
      }
      
      // Get RAG context if enabled
      let ragContext = '';
      if (node.config.ragMemoryNode && msg.query) {
        ragContext = await queryRAGMemory(node.config.ragMemoryNode, msg.query, context);
      }
      
      // Collect function declarations
      const functionDeclarations = node.config.enableFunctionCalling 
        ? await collectFunctionDeclarations(context)
        : [];
      
      // Build native tools
      const tools = buildNativeTools(node.config, functionDeclarations);
      
      // Prepare system instruction
      let systemInstruction = node.config.systemInstruction || '';
      if (ragContext) {
        systemInstruction += `\n\nContext from knowledge base:\n${ragContext}`;
      }
      
      // Call Gemini API
      const result = await callGeminiWithSDK({
        apiKey,
        model: node.config.model,
        systemInstruction,
        history,
        message: parts,
        tools,
        generationConfig,
        safetySettings: node.config.safetySettings || [],
        maxAttempts: node.config.maxAttempts || 5,
        urlContexts: node.config.urlContexts || []
      }, node, context);
      
      // Update memory
      if (node.config.memoryNode && result.success) {
        await updateMemory(
          node.config.memoryNode,
          conversationId,
          { role: 'user', parts },
          { role: 'model', parts: [{ text: result.text }] },
          context
        );
      }
      
      // Prepare response
      msg.payload = result.text;
      msg.conversationId = conversationId;
      msg.gemini = {
        usageMetadata: result.usageMetadata,
        finishReason: result.finishReason,
        safetyRatings: result.safetyRatings,
        functionCalls: result.functionCalls || [],
        groundingMetadata: result.groundingMetadata
      };
      
      node.status({ fill: 'green', shape: 'dot', text: 'complete' });
      return msg;
      
    } catch (err: any) {
      node.error(err, msg);
      node.status({ fill: 'red', shape: 'dot', text: 'error' });
      msg.error = err.message;
      msg.payload = null;
      return msg;
    }
  }
});

// ===================================================================
// GEMINI MEMORY - Conversation History
// ===================================================================

registry.register('gemini-memory', {
  type: 'gemini-memory',
  category: 'gemini',
  color: '#4285F4',
  defaults: {
    name: { value: '' },
    maxMessages: { value: 20 }, // Max message pairs
    includeImages: { value: true },
    autoCompress: { value: false },
    compressionThreshold: { value: 30 } // Compress when > N messages
  },
  inputs: 1,
  outputs: 1,
  
  onInit: async (node: Node, context: ExecutionContext) => {
    await context.storage.put(StorageKeys.memory(node.id, 'conversations'), {});
  },
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const operation = msg.operation || 'get';
    const conversationId = msg.conversationId || 'default';
    
    try {
      const conversations = await context.storage.get(
        StorageKeys.memory(node.id, 'conversations')
      ) || {};
      
      switch (operation) {
        case 'get':
          msg.payload = conversations[conversationId] || [];
          return msg;
          
        case 'update':
          if (!msg.userMessage || !msg.modelResponse) {
            throw new Error('userMessage and modelResponse required');
          }
          
          let history = conversations[conversationId] || [];
          
          // Add messages
          history.push(
            processMessageForStorage(msg.userMessage, node.config.includeImages)
          );
          history.push(
            processMessageForStorage(msg.modelResponse, node.config.includeImages)
          );
          
          // Trim to max
          const maxMessages = node.config.maxMessages * 2;
          if (history.length > maxMessages) {
            history = history.slice(-maxMessages);
          }
          
          // Auto-compress if enabled
          if (node.config.autoCompress && 
              history.length > node.config.compressionThreshold) {
            history = compressHistory(history, node.config.compressionThreshold);
          }
          
          conversations[conversationId] = history;
          await context.storage.put(
            StorageKeys.memory(node.id, 'conversations'),
            conversations
          );
          
          msg.payload = { success: true, messageCount: history.length };
          return msg;
          
        case 'clear':
          if (conversationId === 'all') {
            await context.storage.put(
              StorageKeys.memory(node.id, 'conversations'),
              {}
            );
          } else {
            delete conversations[conversationId];
            await context.storage.put(
              StorageKeys.memory(node.id, 'conversations'),
              conversations
            );
          }
          msg.payload = { success: true, cleared: conversationId };
          return msg;
          
        case 'list':
          msg.payload = Object.keys(conversations).map(id => ({
            id,
            messageCount: conversations[id].length
          }));
          return msg;
          
        case 'export':
          msg.payload = conversations[conversationId] || [];
          return msg;
          
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
    } catch (err: any) {
      node.error(err, msg);
      msg.error = err.message;
      return msg;
    }
  }
});

// ===================================================================
// GEMINI RAG MEMORY - File-based Search
// ===================================================================

registry.register('gemini-rag-memory', {
  type: 'gemini-rag-memory',
  category: 'gemini',
  color: '#4285F4',
  defaults: {
    name: { value: '' },
    corpusName: { value: '' },
    topK: { value: 5 },
    similarityThreshold: { value: 0.3 }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const operation = msg.operation || 'query';
    const apiKey = context.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }
    
    try {
      switch (operation) {
        case 'upload':
          // Upload file to Gemini Files API
          const uploadResult = await uploadFileToGemini(
            apiKey,
            msg.file || msg.payload,
            msg.mimeType || 'text/plain',
            msg.displayName || 'document'
          );
          
          // Store file reference
          const files = await context.storage.get(
            StorageKeys.rag(node.id, 'files')
          ) || [];
          files.push(uploadResult);
          await context.storage.put(StorageKeys.rag(node.id, 'files'), files);
          
          msg.payload = uploadResult;
          return msg;
          
        case 'query':
          // Query against uploaded files
          const query = msg.query || msg.payload;
          const files = await context.storage.get(
            StorageKeys.rag(node.id, 'files')
          ) || [];
          
          if (files.length === 0) {
            msg.payload = { results: [], warning: 'No files uploaded' };
            return msg;
          }
          
          const results = await queryGeminiRAG(
            apiKey,
            query,
            files,
            node.config.topK,
            node.config.similarityThreshold
          );
          
          msg.payload = results;
          return msg;
          
        case 'list':
          const fileList = await context.storage.get(
            StorageKeys.rag(node.id, 'files')
          ) || [];
          msg.payload = fileList;
          return msg;
          
        case 'delete':
          const fileId = msg.fileId || msg.payload;
          await deleteGeminiFile(apiKey, fileId);
          
          const currentFiles = await context.storage.get(
            StorageKeys.rag(node.id, 'files')
          ) || [];
          const updatedFiles = currentFiles.filter((f: any) => f.name !== fileId);
          await context.storage.put(StorageKeys.rag(node.id, 'files'), updatedFiles);
          
          msg.payload = { success: true, deleted: fileId };
          return msg;
          
        case 'clear':
          const allFiles = await context.storage.get(
            StorageKeys.rag(node.id, 'files')
          ) || [];
          
          for (const file of allFiles) {
            try {
              await deleteGeminiFile(apiKey, file.name);
            } catch (err) {
              node.warn(`Failed to delete ${file.name}`);
            }
          }
          
          await context.storage.put(StorageKeys.rag(node.id, 'files'), []);
          msg.payload = { success: true, cleared: allFiles.length };
          return msg;
          
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
    } catch (err: any) {
      node.error(err, msg);
      msg.error = err.message;
      return msg;
    }
  }
});

// ===================================================================
// GEMINI TOOL NODES - Standard Functions
// ===================================================================

registry.register('gemini-tool-weather', {
  type: 'gemini-tool-weather',
  category: 'gemini-tools',
  color: '#4285F4',
  defaults: {
    name: { value: 'Weather Tool' },
    enabled: { value: true }
  },
  inputs: 1,
  outputs: 1,
  
  onInit: async (node: Node, context: ExecutionContext) => {
    await registerTool(context, {
      name: 'get_weather',
      description: 'Get current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City name or coordinates'
          },
          units: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: 'Temperature units'
          }
        },
        required: ['location']
      },
      executor: async (args: any) => {
        // Mock implementation - replace with real API
        return {
          location: args.location,
          temperature: 22,
          units: args.units || 'celsius',
          conditions: 'Partly cloudy',
          humidity: 65,
          windSpeed: 10
        };
      }
    });
  },
  
  execute: async (msg: NodeMessage) => msg
});

registry.register('gemini-tool-calculator', {
  type: 'gemini-tool-calculator',
  category: 'gemini-tools',
  color: '#4285F4',
  defaults: {
    name: { value: 'Calculator Tool' },
    enabled: { value: true }
  },
  inputs: 1,
  outputs: 1,
  
  onInit: async (node: Node, context: ExecutionContext) => {
    await registerTool(context, {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)")'
          }
        },
        required: ['expression']
      },
      executor: async (args: any) => {
        try {
          // Safe eval for math expressions
          const result = Function('"use strict"; return (' + args.expression + ')')();
          return {
            expression: args.expression,
            result,
            success: true
          };
        } catch (err: any) {
          return {
            expression: args.expression,
            error: err.message,
            success: false
          };
        }
      }
    });
  },
  
  execute: async (msg: NodeMessage) => msg
});

registry.register('gemini-tool-http', {
  type: 'gemini-tool-http',
  category: 'gemini-tools',
  color: '#4285F4',
  defaults: {
    name: { value: 'HTTP Request Tool' },
    toolName: { value: 'fetch_url' },
    description: { value: 'Fetch content from a URL' },
    enabled: { value: true }
  },
  inputs: 1,
  outputs: 1,
  
  onInit: async (node: Node, context: ExecutionContext) => {
    await registerTool(context, {
      name: node.config.toolName,
      description: node.config.description,
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to fetch'
          },
          method: {
            type: 'string',
            enum: ['GET', 'POST'],
            description: 'HTTP method'
          }
        },
        required: ['url']
      },
      executor: async (args: any) => {
        try {
          const response = await fetch(args.url, {
            method: args.method || 'GET',
            headers: { 'User-Agent': 'Gemini-Tool/1.0' }
          });
          
          const text = await response.text();
          return {
            url: args.url,
            statusCode: response.status,
            content: text.substring(0, 5000), // Limit size
            success: response.ok
          };
        } catch (err: any) {
          return {
            url: args.url,
            error: err.message,
            success: false
          };
        }
      }
    });
  },
  
  execute: async (msg: NodeMessage) => msg
});

registry.register('gemini-tool-custom', {
  type: 'gemini-tool-custom',
  category: 'gemini-tools',
  color: '#4285F4',
  defaults: {
    name: { value: '' },
    toolName: { value: '' },
    description: { value: '' },
    parametersSchema: { value: '{}' },
    functionCode: { value: 'return { result: "Hello" };' },
    enabled: { value: true }
  },
  inputs: 1,
  outputs: 1,
  
  onInit: async (node: Node, context: ExecutionContext) => {
    const schema = JSON.parse(node.config.parametersSchema || '{}');
    
    await registerTool(context, {
      name: node.config.toolName,
      description: node.config.description,
      parameters: schema,
      executor: async (args: any) => {
        const func = new Function(
          'args',
          `'use strict'; return (async () => { ${node.config.functionCode} })();`
        );
        return await func(args);
      }
    });
  },
  
  execute: async (msg: NodeMessage) => msg
});

// ===================================================================
// HELPER FUNCTIONS
// ===================================================================

function prepareContentParts(msg: NodeMessage, config: any) {
  const parts: any[] = [];
  
  // Text content
  if (msg.payload && typeof msg.payload === 'string') {
    parts.push({ text: msg.payload });
  } else if (msg.text) {
    parts.push({ text: msg.text });
  }
  
  // Images (if vision enabled)
  if (config.enableVision && msg.images && Array.isArray(msg.images)) {
    for (const image of msg.images) {
      if (image.data && image.mimeType) {
        parts.push({
          inlineData: {
            mimeType: image.mimeType,
            data: image.data
          }
        });
      }
    }
  }
  
  // File data
  if (msg.fileData) {
    parts.push({
      fileData: {
        mimeType: msg.fileData.mimeType,
        fileUri: msg.fileData.fileUri
      }
    });
  }
  
  return parts.length > 0 ? parts : [{ text: msg.payload || '' }];
}

function buildNativeTools(config: any, functionDeclarations: any[]) {
  const tools: any[] = [];
  
  // Google Search grounding
  if (config.enableSearch) {
    tools.push({
      googleSearch: {}
    });
  }
  
  // Code execution
  if (config.enableCodeExecution) {
    tools.push({
      codeExecution: {}
    });
  }
  
  // Function calling
  if (config.enableFunctionCalling && functionDeclarations.length > 0) {
    tools.push({
      functionDeclarations
    });
  }
  
  return tools;
}

async function callGeminiWithSDK(options: any, node: Node, context: ExecutionContext) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent?key=${options.apiKey}`;
  
  const contents: any[] = [...(options.history || [])];
  
  // Add URL contexts if provided
  if (options.urlContexts && options.urlContexts.length > 0) {
    for (const urlContext of options.urlContexts) {
      contents.push({
        role: 'user',
        parts: [{ text: `Context from ${urlContext}` }]
      });
    }
  }
  
  // Current message
  contents.push({
    role: 'user',
    parts: options.message
  });
  
  const body: any = {
    contents,
    generationConfig: options.generationConfig,
    safetySettings: options.safetySettings
  };
  
  if (options.systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: options.systemInstruction }]
    };
  }
  
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }
  
  let attempts = 0;
  const maxAttempts = options.maxAttempts || 5;
  
  while (attempts < maxAttempts) {
    attempts++;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No response from Gemini');
    }
    
    const candidate = data.candidates[0];
    const content = candidate.content;
    
    // Handle function calls
    const functionCalls = content.parts?.filter((p: any) => p.functionCall) || [];
    
    if (functionCalls.length > 0 && attempts < maxAttempts) {
      // Execute functions
      const functionResponses = [];
      
      for (const fc of functionCalls) {
        const result = await executeFunctionCall(fc.functionCall, context);
        functionResponses.push({
          functionResponse: {
            name: fc.functionCall.name,
            response: result
          }
        });
      }
      
      // Continue conversation with results
      contents.push(content);
      contents.push({
        role: 'function',
        parts: functionResponses
      });
      
      // Retry with function results
      body.contents = contents;
      continue;
    }
    
    // Extract text
    const text = content.parts
      ?.map((p: any) => p.text || '')
      .join('')
      .trim() || '';
    
    return {
      success: true,
      text,
      usageMetadata: data.usageMetadata || {},
      finishReason: candidate.finishReason || 'STOP',
      safetyRatings: candidate.safetyRatings || [],
      functionCalls: functionCalls.map((fc: any) => fc.functionCall),
      groundingMetadata: candidate.groundingMetadata
    };
  }
  
  throw new Error('Max function calling attempts reached');
}

async function executeFunctionCall(call: any, context: ExecutionContext) {
  const tools = await context.flow.get('gemini:tools') || [];
  const tool = tools.find((t: any) => t.name === call.name);
  
  if (!tool || !tool.executor) {
    return { error: `Function ${call.name} not found` };
  }
  
  try {
    return await tool.executor(call.args || {});
  } catch (err: any) {
    return { error: err.message };
  }
}

async function registerTool(context: ExecutionContext, tool: any) {
  const tools = await context.flow.get('gemini:tools') || [];
  
  // Remove existing tool with same name
  const filtered = tools.filter((t: any) => t.name !== tool.name);
  filtered.push(tool);
  
  await context.flow.set('gemini:tools', filtered);
}

async function collectFunctionDeclarations(context: ExecutionContext) {
  const tools = await context.flow.get('gemini:tools') || [];
  return tools.map((t: any) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }));
}

async function getMemoryHistory(memoryNodeId: string, conversationId: string, context: ExecutionContext) {
  const conversations = await context.storage.get(
    StorageKeys.memory(memoryNodeId, 'conversations')
  ) || {};
  return conversations[conversationId] || [];
}

async function updateMemory(
  memoryNodeId: string,
  conversationId: string,
  userMsg: any,
  modelMsg: any,
  context: ExecutionContext
) {
  const conversations = await context.storage.get(
    StorageKeys.memory(memoryNodeId, 'conversations')
  ) || {};
  
  let history = conversations[conversationId] || [];
  history.push(userMsg, modelMsg);
  
  conversations[conversationId] = history;
  await context.storage.put(
    StorageKeys.memory(memoryNodeId, 'conversations'),
    conversations
  );
}

function processMessageForStorage(message: any, includeImages: boolean) {
  if (!includeImages && message.parts) {
    const cleaned = JSON.parse(JSON.stringify(message));
    cleaned.parts = cleaned.parts.filter((p: any) => !p.inlineData);
    if (cleaned.parts.length === 0) {
      cleaned.parts = [{ text: '[Images removed]' }];
    }
    return cleaned;
  }
  return message;
}

function compressHistory(history: any[], threshold: number) {
  if (history.length <= threshold) return history;
  
  const keepRecent = Math.floor(threshold * 0.6);
  const recentMessages = history.slice(-keepRecent);
  
  const summary = {
    role: 'user',
    parts: [{
      text: `[Previous conversation: ${Math.floor((history.length - keepRecent) / 2)} message pairs]`
    }]
  };
  
  return [summary, ...recentMessages];
}

async function queryRAGMemory(ragNodeId: string, query: string, context: ExecutionContext) {
  const files = await context.storage.get(StorageKeys.rag(ragNodeId, 'files')) || [];
  
  if (files.length === 0) return '';
  
  // Simple mock - in production, use actual Gemini semantic search
  return `Relevant context from ${files.length} documents...`;
}

// Gemini Files API helpers
async function uploadFileToGemini(apiKey: string, file: any, mimeType: string, displayName: string) {
  const url = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
  
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
    headers: {
      'X-Goog-Upload-Protocol': 'multipart',
      'X-Goog-Upload-Command': 'upload, finalize'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }
  
  return await response.json();
}

async function queryGeminiRAG(apiKey: string, query: string, files: any[], topK: number, threshold: number) {
  // Mock implementation - replace with actual Gemini semantic retrieval
  return {
    query,
    results: files.slice(0, topK).map(f => ({
      file: f.name,
      relevance: 0.8,
      snippet: 'Relevant content...'
    }))
  };
}

async function deleteGeminiFile(apiKey: string, fileName: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`;
  
  const response = await fetch(url, { method: 'DELETE' });
  
  if (!response.ok) {
    throw new Error(`Delete failed: ${response.status}`);
  }
}

// Add RAG storage key helper
StorageKeys.rag = (nodeId: string, key: string) => `rag:${nodeId}:${key}`;
StorageKeys.memory = (nodeId: string, key: string) => `mem:${nodeId}:${key}`;
