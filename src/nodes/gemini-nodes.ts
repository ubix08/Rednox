// ===================================================================
// RedNox - Gemini AI Nodes
// ===================================================================

import { registry } from '../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext } from '../types/core';
import { RED, StorageKeys } from '../utils';

// ===================================================================
// GEMINI MODEL CONFIG NODE
// ===================================================================

registry.register('gemini-model-config', {
  type: 'gemini-model-config',
  category: 'config',
  color: '#4285F4',
  defaults: {
    name: { value: '' },
    model: { value: 'gemini-2.0-flash-exp' },
    temperature: { value: 0.7 },
    topP: { value: 0.95 },
    topK: { value: 40 },
    maxOutputTokens: { value: 8192 },
    safetySettings: { value: [] }
  },
  inputs: 0,
  outputs: 0,
  execute: async (msg: NodeMessage) => null
});

// ===================================================================
// GEMINI TOOL - CUSTOM FUNCTION
// ===================================================================

registry.register('gemini-tool-function', {
  type: 'gemini-tool-function',
  category: 'gemini-tools',
  color: '#4285F4',
  defaults: {
    name: { value: '' },
    toolName: { value: '' },
    description: { value: '' },
    parametersSchema: { value: '{}' },
    functionCode: { value: 'return {};' },
    enabled: { value: true }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const operation = msg.operation || 'execute';
    
    if (!node.config.enabled) {
      node.warn('Tool is disabled');
      return null;
    }
    
    try {
      switch (operation) {
        case 'info':
          msg.payload = {
            toolName: node.config.toolName,
            description: node.config.description,
            functionDeclaration: getFunctionDeclaration(node),
            parametersSchema: JSON.parse(node.config.parametersSchema || '{}')
          };
          return msg;
          
        case 'execute':
          const args = msg.args || msg.payload || {};
          const result = await executeToolFunction(node, args, context);
          msg.payload = result;
          msg.toolName = node.config.toolName;
          return msg;
          
        case 'test':
          const testArgs = msg.testArgs || {};
          try {
            const testResult = await executeToolFunction(node, testArgs, context);
            msg.payload = { success: true, result: testResult };
          } catch (err: any) {
            msg.payload = { success: false, error: err.message };
          }
          return msg;
          
        default:
          msg.payload = `Unknown operation: ${operation}`;
          return msg;
      }
    } catch (err: any) {
      node.error(err, msg);
      msg.error = err.message;
      msg.payload = null;
      return msg;
    }
  }
});

function getFunctionDeclaration(node: Node) {
  const schema = JSON.parse(node.config.parametersSchema || '{}');
  return {
    name: node.config.toolName,
    description: node.config.description,
    parameters: {
      type: 'object',
      properties: schema.properties || {},
      required: schema.required || []
    }
  };
}

async function executeToolFunction(node: Node, args: any, context: ExecutionContext): Promise<any> {
  const safeContext = {
    args,
    console,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    crypto,
    utils: {
      parseJSON: (str: string) => {
        try { return JSON.parse(str); } catch { return null; }
      },
      formatDate: (date: any) => new Date(date).toISOString(),
      validateEmail: (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    }
  };
  
  const func = new Function(
    'args', 'console', 'JSON', 'Math', 'Date', 'Array', 'Object', 
    'String', 'Number', 'Boolean', 'crypto', 'utils',
    `'use strict'; return (async () => { ${node.config.functionCode} })();`
  );
  
  const result = await func(
    safeContext.args,
    safeContext.console,
    safeContext.JSON,
    safeContext.Math,
    safeContext.Date,
    safeContext.Array,
    safeContext.Object,
    safeContext.String,
    safeContext.Number,
    safeContext.Boolean,
    safeContext.crypto,
    safeContext.utils
  );
  
  return JSON.parse(JSON.stringify(result || {}));
}

// ===================================================================
// GEMINI TOOL - HTTP REQUEST
// ===================================================================

registry.register('gemini-tool-http', {
  type: 'gemini-tool-http',
  category: 'gemini-tools',
  color: '#4285F4',
  defaults: {
    name: { value: '' },
    toolName: { value: '' },
    description: { value: '' },
    method: { value: 'GET' },
    url: { value: '' },
    headers: { value: '{}' },
    body: { value: '' },
    timeout: { value: 30000 },
    parametersSchema: { value: '{}' },
    enabled: { value: true }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const operation = msg.operation || 'execute';
    
    if (!node.config.enabled) {
      node.warn('Tool is disabled');
      return null;
    }
    
    try {
      switch (operation) {
        case 'info':
          msg.payload = {
            toolName: node.config.toolName,
            description: node.config.description,
            method: node.config.method,
            url: node.config.url,
            functionDeclaration: getHttpFunctionDeclaration(node)
          };
          return msg;
          
        case 'execute':
          const args = msg.args || msg.payload || {};
          const result = await executeHttpTool(node, args);
          msg.payload = result;
          msg.toolName = node.config.toolName;
          return msg;
          
        case 'test':
          const testArgs = msg.testArgs || {};
          try {
            const testResult = await executeHttpTool(node, testArgs);
            msg.payload = { success: true, result: testResult };
          } catch (err: any) {
            msg.payload = { success: false, error: err.message };
          }
          return msg;
          
        default:
          msg.payload = `Unknown operation: ${operation}`;
          return msg;
      }
    } catch (err: any) {
      node.error(err, msg);
      msg.error = err.message;
      msg.payload = null;
      return msg;
    }
  }
});

function getHttpFunctionDeclaration(node: Node) {
  const schema = JSON.parse(node.config.parametersSchema || '{}');
  return {
    name: node.config.toolName,
    description: node.config.description,
    parameters: {
      type: 'object',
      properties: schema.properties || {},
      required: schema.required || []
    }
  };
}

function replaceTemplate(template: string, args: any): string {
  if (typeof template !== 'string') return template;
  
  return template.replace(/\$\{([^}]+)\}/g, (match, key) => {
    const keys = key.split('.');
    let value: any = args;
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return match;
      }
    }
    
    return String(value);
  });
}

async function executeHttpTool(node: Node, args: any): Promise<any> {
  const processedUrl = replaceTemplate(node.config.url, args);
  const headers = JSON.parse(node.config.headers || '{}');
  
  const processedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    processedHeaders[key] = replaceTemplate(String(value), args);
  }
  
  if (!processedHeaders['User-Agent']) {
    processedHeaders['User-Agent'] = 'RedNox-Gemini-Tool/1.0';
  }
  
  let body: string | undefined;
  const method = node.config.method.toUpperCase();
  
  if (['POST', 'PUT', 'PATCH'].includes(method) && node.config.body) {
    body = replaceTemplate(node.config.body, args);
    
    if (!processedHeaders['Content-Type']) {
      try {
        JSON.parse(body);
        processedHeaders['Content-Type'] = 'application/json';
      } catch {
        processedHeaders['Content-Type'] = 'text/plain';
      }
    }
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), node.config.timeout || 30000);
  
  try {
    const response = await fetch(processedUrl, {
      method,
      headers: processedHeaders,
      body,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    let data: any;
    
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    
    return {
      success: true,
      statusCode: response.status,
      headers: Object.fromEntries(response.headers),
      data,
      url: processedUrl,
      method
    };
    
  } catch (err: any) {
    clearTimeout(timeoutId);
    return {
      success: false,
      error: err.message,
      url: processedUrl,
      method
    };
  }
}

// ===================================================================
// GEMINI MEMORY - IN-MEMORY
// ===================================================================

registry.register('gemini-memory-inmem', {
  type: 'gemini-memory-inmem',
  category: 'gemini-memory',
  color: '#4285F4',
  defaults: {
    name: { value: '' },
    maxItems: { value: 20 },
    includeImages: { value: true },
    autoCompress: { value: false }
  },
  inputs: 1,
  outputs: 1,
  
  onInit: async (node: Node, context: ExecutionContext) => {
    await context.storage.put(StorageKeys.memory(node.id, 'conversations'), {});
  },
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const operation = msg.operation || msg.payload;
    const conversationId = msg.conversationId || 'default';
    
    try {
      const conversations = await context.storage.get(StorageKeys.memory(node.id, 'conversations')) || {};
      
      switch (operation) {
        case 'get':
          msg.payload = conversations[conversationId] || [];
          return msg;
          
        case 'update':
          if (!msg.userMessage || !msg.modelResponse) {
            throw new Error('userMessage and modelResponse required for update');
          }
          
          let history = conversations[conversationId] || [];
          
          // Process messages
          const processedUser = processMessage(msg.userMessage, node.config.includeImages);
          const processedModel = processMessage(msg.modelResponse, node.config.includeImages);
          
          history.push(processedUser);
          history.push(processedModel);
          
          // Trim to max items
          const maxItems = node.config.maxItems || 20;
          if (history.length > maxItems * 2) {
            const excessPairs = Math.floor((history.length - maxItems * 2) / 2);
            history = history.slice(excessPairs * 2);
          }
          
          // Auto-compress if enabled
          if (node.config.autoCompress && history.length > 10) {
            history = compressOldMessages(history);
          }
          
          conversations[conversationId] = history;
          await context.storage.put(StorageKeys.memory(node.id, 'conversations'), conversations);
          
          msg.payload = { success: true, messageCount: history.length };
          return msg;
          
        case 'clear':
          if (conversationId === 'all') {
            await context.storage.put(StorageKeys.memory(node.id, 'conversations'), {});
          } else {
            delete conversations[conversationId];
            await context.storage.put(StorageKeys.memory(node.id, 'conversations'), conversations);
          }
          msg.payload = 'Memory cleared';
          return msg;
          
        case 'stats':
          const stats = {
            totalConversations: Object.keys(conversations).length,
            conversations: Object.entries(conversations).map(([id, history]) => ({
              id,
              messageCount: (history as any[]).length
            }))
          };
          msg.payload = stats;
          return msg;
          
        default:
          msg.payload = 'Invalid operation. Use: get, update, clear, or stats';
          return msg;
      }
    } catch (err: any) {
      node.error(err, msg);
      msg.error = err.message;
      return msg;
    }
  }
});

function processMessage(message: any, includeImages: boolean) {
  if (!includeImages && message.parts) {
    const processedMessage = JSON.parse(JSON.stringify(message));
    processedMessage.parts = processedMessage.parts.filter((part: any) => !part.inlineData);
    if (processedMessage.parts.length === 0) {
      processedMessage.parts = [{ text: '[Image content removed from memory]' }];
    }
    return processedMessage;
  }
  return message;
}

function compressOldMessages(history: any[]) {
  if (history.length <= 10) return history;
  
  const recentMessages = history.slice(-6);
  const oldMessages = history.slice(0, -6);
  
  const summaryText = `[Previous conversation summary: ${Math.floor(oldMessages.length / 2)} message pairs discussed various topics]`;
  const summaryMessage = {
    role: 'user',
    parts: [{ text: summaryText }]
  };
  
  return [summaryMessage, ...recentMessages];
}

// ===================================================================
// GEMINI AGENT - MAIN NODE
// ===================================================================

registry.register('gemini-agent', {
  type: 'gemini-agent',
  category: 'gemini',
  color: '#4285F4',
  defaults: {
    name: { value: '' },
    modelConfigNode: { value: '' },
    memoryConfigNode: { value: '' },
    systemInstruction: { value: '' },
    enableFunctionCalling: { value: true },
    enableVision: { value: false },
    maxAttempts: { value: 5 }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    try {
      node.status({ fill: 'yellow', shape: 'dot', text: 'processing' });
      
      // Get API key from environment
      const apiKey = context.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured in environment');
      }
      
      // Get model config (from flow data)
      const modelConfig = await getModelConfig(node, context);
      
      // Collect tools from flow
      const tools = await collectTools(node, context);
      
      // Prepare content parts
      const parts = prepareContentParts(msg, node.config.enableVision);
      
      // Get conversation history if memory is enabled
      let conversationHistory: any[] = [];
      const conversationId = msg.conversationId || msg._msgid || 'default';
      
      if (node.config.memoryConfigNode) {
        conversationHistory = await getConversationHistory(node, context, conversationId);
      }
      
      // Make Gemini API call
      const result = await callGeminiAPI({
        apiKey,
        model: modelConfig.model || 'gemini-2.0-flash-exp',
        systemInstruction: node.config.systemInstruction,
        history: conversationHistory,
        message: parts,
        tools,
        generationConfig: modelConfig.generationConfig,
        safetySettings: modelConfig.safetySettings,
        enableFunctionCalling: node.config.enableFunctionCalling,
        maxAttempts: node.config.maxAttempts || 5
      }, node, context);
      
      // Update memory if enabled
      if (node.config.memoryConfigNode && result.success) {
        await updateConversationHistory(
          node,
          context,
          conversationId,
          { role: 'user', parts },
          { role: 'model', parts: [{ text: result.text }] }
        );
      }
      
      // Prepare output
      msg.payload = result.text;
      msg.conversationId = conversationId;
      msg.gemini = {
        usageMetadata: result.usageMetadata,
        finishReason: result.finishReason,
        safetyRatings: result.safetyRatings,
        functionCalls: result.functionCalls
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

async function getModelConfig(node: Node, context: ExecutionContext) {
  const configNodeId = node.config.modelConfigNode;
  if (!configNodeId) {
    return {
      model: 'gemini-2.0-flash-exp',
      generationConfig: { temperature: 0.7, topP: 0.95, topK: 40, maxOutputTokens: 8192 },
      safetySettings: []
    };
  }
  
  // In RedNox, config nodes are stored in flow context
  const config = await context.flow.get(`config:${configNodeId}`);
  return config || {
    model: 'gemini-2.0-flash-exp',
    generationConfig: { temperature: 0.7, topP: 0.95, topK: 40, maxOutputTokens: 8192 },
    safetySettings: []
  };
}

async function collectTools(node: Node, context: ExecutionContext): Promise<any[]> {
  // In RedNox, we need to store tool registrations in context
  const toolsList = await context.flow.get('gemini:tools') || [];
  return toolsList;
}

function prepareContentParts(msg: NodeMessage, enableVision: boolean) {
  const parts: any[] = [];
  
  if (msg.payload && typeof msg.payload === 'string') {
    parts.push({ text: msg.payload });
  }
  
  if (enableVision && msg.images && Array.isArray(msg.images)) {
    for (const image of msg.images) {
      if (image.data && image.mimeType) {
        parts.push({
          inlineData: {
            data: image.data,
            mimeType: image.mimeType
          }
        });
      }
    }
  }
  
  return parts.length > 0 ? parts : [{ text: msg.payload || '' }];
}

async function getConversationHistory(node: Node, context: ExecutionContext, conversationId: string) {
  const memoryNodeId = node.config.memoryConfigNode;
  if (!memoryNodeId) return [];
  
  const conversations = await context.storage.get(StorageKeys.memory(memoryNodeId, 'conversations')) || {};
  return conversations[conversationId] || [];
}

async function updateConversationHistory(
  node: Node,
  context: ExecutionContext,
  conversationId: string,
  userMessage: any,
  modelMessage: any
) {
  const memoryNodeId = node.config.memoryConfigNode;
  if (!memoryNodeId) return;
  
  const conversations = await context.storage.get(StorageKeys.memory(memoryNodeId, 'conversations')) || {};
  let history = conversations[conversationId] || [];
  
  history.push(userMessage);
  history.push(modelMessage);
  
  conversations[conversationId] = history;
  await context.storage.put(StorageKeys.memory(memoryNodeId, 'conversations'), conversations);
}

async function callGeminiAPI(
  options: any,
  node: Node,
  context: ExecutionContext
): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent?key=${options.apiKey}`;
  
  const contents: any[] = [];
  
  // Add history
  if (options.history && options.history.length > 0) {
    contents.push(...options.history);
  }
  
  // Add current message
  contents.push({
    role: 'user',
    parts: options.message
  });
  
  const body: any = {
    contents,
    generationConfig: options.generationConfig || {},
    safetySettings: options.safetySettings || []
  };
  
  if (options.systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: options.systemInstruction }]
    };
  }
  
  if (options.enableFunctionCalling && options.tools && options.tools.length > 0) {
    body.tools = [{ functionDeclarations: options.tools }];
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  
  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('No response from Gemini API');
  }
  
  const candidate = data.candidates[0];
  const content = candidate.content;
  
  // Handle function calls
  if (content.parts && content.parts.some((p: any) => p.functionCall)) {
    const functionCall = content.parts.find((p: any) => p.functionCall)?.functionCall;
    
    if (options.enableFunctionCalling && functionCall) {
      // Execute tool
      const toolResult = await executeToolByName(functionCall.name, functionCall.args, context);
      
      // Continue conversation with tool result
      const newContents = [...contents, content, {
        role: 'function',
        parts: [{
          functionResponse: {
            name: functionCall.name,
            response: toolResult
          }
        }]
      }];
      
      // Recursive call with tool result
      return callGeminiAPI({ ...options, history: newContents.slice(0, -1), message: newContents[newContents.length - 1].parts }, node, context);
    }
  }
  
  const text = content.parts?.map((p: any) => p.text || '').join('') || '';
  
  return {
    success: true,
    text,
    usageMetadata: data.usageMetadata || {},
    finishReason: candidate.finishReason || 'STOP',
    safetyRatings: candidate.safetyRatings || [],
    functionCalls: content.parts?.filter((p: any) => p.functionCall).map((p: any) => p.functionCall) || []
  };
}

async function executeToolByName(toolName: string, args: any, context: ExecutionContext): Promise<any> {
  const tools = await context.flow.get('gemini:tools') || [];
  const tool = tools.find((t: any) => t.name === toolName);
  
  if (!tool || !tool.executor) {
    throw new Error(`Tool '${toolName}' not found`);
  }
  
  return await tool.executor(args, context);
}

// ===================================================================
// Storage Key Helper
// ===================================================================

StorageKeys.memory = (nodeId: string, key: string) => `mem:${nodeId}:${key}`;
