
// ===================================================================
// RedNox - Gemini Agent Nodes with Google GenAI SDK
// ===================================================================

import { registry } from '../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext } from '../types/core';
import { RED, executeSafeFunction } from '../utils';

// ===================================================================
// Types & Interfaces
// ===================================================================

interface GeminiModelConfig {
  apiKey?: string;
  model: string;
  temperature: number;
  topP: number;
  topK: number;
  maxOutputTokens: number;
  safetySettings?: any[];
}

interface GeminiMemoryConfig {
  storageType: 'inmem' | 'context-flow' | 'context-global';
  maxItems: number;
  contextKey?: string;
  includeImages: boolean;
  autoCompress: boolean;
  ttl: number;
}

interface ConversationTurn {
  role: 'user' | 'model';
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
}

interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

interface ToolRegistry {
  [toolName: string]: {
    nodeId: string;
    declaration: ToolDeclaration;
    node?: Node;
  };
}

interface FunctionCall {
  name: string;
  args: Record<string, any>;
}

// ===================================================================
// GEMINI MODEL CONFIG NODE
// ===================================================================

registry.register('gemini-model-config', {
  type: 'gemini-model-config',
  category: 'config',
  color: '#4285F4',
  defaults: {
    name: { value: '' },
    apiKey: { value: '' },
    model: { value: 'gemini-2.0-flash-exp' },
    temperature: { value: 0.7 },
    topP: { value: 0.95 },
    topK: { value: 40 },
    maxOutputTokens: { value: 8192 },
    safetySettings: { value: [] }
  },
  inputs: 0,
  outputs: 0,
  icon: 'icon.svg',
  label: function() {
    return this.name || `Gemini (${this.model})`;
  },
  execute: async () => null
});

// ===================================================================
// GEMINI MEMORY NODE
// ===================================================================

registry.register('gemini-memory-inmem', {
  type: 'gemini-memory-inmem',
  category: 'config',
  color: '#34A853',
  defaults: {
    name: { value: '' },
    storageType: { value: 'inmem' },
    maxItems: { value: 20 },
    contextKey: { value: 'conversation' },
    includeImages: { value: false },
    autoCompress: { value: true },
    ttl: { value: 3600 }
  },
  inputs: 0,
  outputs: 0,
  icon: 'icon.svg',
  label: function() {
    return this.name || 'Memory (In-Memory)';
  },
  execute: async () => null
});

registry.register('gemini-memory-context', {
  type: 'gemini-memory-context',
  category: 'config',
  color: '#34A853',
  defaults: {
    name: { value: '' },
    storageType: { value: 'context-flow' },
    maxItems: { value: 20 },
    contextKey: { value: 'conversation' },
    includeImages: { value: false },
    autoCompress: { value: false },
    ttl: { value: 3600 }
  },
  inputs: 0,
  outputs: 0,
  icon: 'icon.svg',
  label: function() {
    return this.name || 'Memory (Context)';
  },
  execute: async () => null
});

// ===================================================================
// GEMINI TOOL FUNCTION NODE (Base)
// ===================================================================

registry.register('gemini-tool-function', {
  type: 'gemini-tool-function',
  category: 'function',
  color: '#FBBC04',
  defaults: {
    name: { value: '' },
    toolName: { value: '' },
    description: { value: '' },
    parametersSchema: { value: '{}' },
    functionCode: { value: 'return { result: "Hello" };' },
    enabled: { value: true },
    requireConfirmation: { value: false },
    timeout: { value: 30000 }
  },
  inputs: 0,
  outputs: 0,
  icon: 'function.svg',
  label: function() {
    return this.name || `Tool: ${this.toolName || 'unnamed'}`;
  },
  execute: async () => null
});

// ===================================================================
// GEMINI AGENT NODE (Main Orchestrator)
// ===================================================================

registry.register('gemini-agent', {
  type: 'gemini-agent',
  category: 'function',
  color: '#4285F4',
  defaults: {
    name: { value: '' },
    modelConfigNode: { value: '' },
    memoryConfigNode: { value: '' },
    systemInstruction: { value: 'You are a helpful assistant.' },
    enableFunctionCalling: { value: true },
    toolNodes: { value: [] },
    enableVision: { value: false },
    enableCodeExecution: { value: false },
    maxIterations: { value: 10 },
    sessionMode: { value: 'auto' }
  },
  inputs: 1,
  outputs: 1,
  icon: 'icon.svg',
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    try {
      // Get model configuration
      const modelConfig = await getModelConfig(node, context);
      if (!modelConfig) {
        node.error('Model configuration not found or invalid', msg);
        return null;
      }

      // Get memory configuration
      const memoryConfig = await getMemoryConfig(node, context);

      // Get session ID
      const sessionId = getSessionId(msg, node.config.sessionMode);

      // Load conversation history
      const history = await loadHistory(sessionId, memoryConfig, context, node);

      // Add user message to history
      const userMessage = extractUserMessage(msg);
      history.push({
        role: 'user',
        parts: [{ text: userMessage }]
      });

      // Discover and load tools
      const tools = node.config.enableFunctionCalling 
        ? await discoverTools(node, context)
        : {};

      // Call Gemini API with function calling loop
      const result = await callGeminiWithTools({
        modelConfig,
        history,
        systemInstruction: node.config.systemInstruction,
        tools,
        maxIterations: node.config.maxIterations || 10,
        node,
        context,
        msg
      });

      // Save conversation history
      await saveHistory(sessionId, result.history, memoryConfig, context, node);

      // Return response
      msg.payload = result.response;
      msg.conversationHistory = result.history;
      msg.functionCalls = result.functionCalls;
      msg.tokensUsed = result.tokensUsed;
      msg.sessionId = sessionId;

      node.status({ 
        fill: 'green', 
        shape: 'dot', 
        text: `${result.functionCalls?.length || 0} calls, ${result.tokensUsed?.total || 0} tokens` 
      });

      return msg;

    } catch (err: any) {
      node.error(`Gemini Agent error: ${err.message}`, msg);
      node.status({ fill: 'red', shape: 'dot', text: 'Error' });
      return null;
    }
  }
});

// ===================================================================
// HELPER FUNCTIONS
// ===================================================================

async function getModelConfig(node: Node, context: ExecutionContext): Promise<GeminiModelConfig | null> {
  const configNodeId = node.config.modelConfigNode;
  if (!configNodeId) {
    return null;
  }

  // Find config node in flow
  const flowEngine = context.flowEngine;
  if (!flowEngine) return null;

  const configNode = flowEngine['nodes'].get(configNodeId);
  if (!configNode) return null;

  return {
    apiKey: configNode.config.apiKey || context.env.GEMINI_API_KEY,
    model: configNode.config.model || 'gemini-2.0-flash-exp',
    temperature: configNode.config.temperature || 0.7,
    topP: configNode.config.topP || 0.95,
    topK: configNode.config.topK || 40,
    maxOutputTokens: configNode.config.maxOutputTokens || 8192,
    safetySettings: configNode.config.safetySettings || []
  };
}

async function getMemoryConfig(node: Node, context: ExecutionContext): Promise<GeminiMemoryConfig | null> {
  const configNodeId = node.config.memoryConfigNode;
  if (!configNodeId) {
    return {
      storageType: 'inmem',
      maxItems: 20,
      includeImages: false,
      autoCompress: false,
      ttl: 3600
    };
  }

  const flowEngine = context.flowEngine;
  if (!flowEngine) return null;

  const configNode = flowEngine['nodes'].get(configNodeId);
  if (!configNode) return null;

  return {
    storageType: configNode.config.storageType || 'inmem',
    maxItems: configNode.config.maxItems || 20,
    contextKey: configNode.config.contextKey || 'conversation',
    includeImages: configNode.config.includeImages || false,
    autoCompress: configNode.config.autoCompress || false,
    ttl: configNode.config.ttl || 3600
  };
}

function getSessionId(msg: NodeMessage, mode: string): string {
  if (mode === 'auto') {
    return msg.sessionId || 
           msg.headers?.['x-session-id'] || 
           msg.userId || 
           'default';
  } else if (mode === 'user') {
    return msg.userId || msg.headers?.['x-user-id'] || 'default';
  } else if (mode === 'global') {
    return 'global';
  }
  return 'default';
}

function extractUserMessage(msg: NodeMessage): string {
  if (typeof msg.payload === 'string') {
    return msg.payload;
  } else if (msg.payload?.message) {
    return msg.payload.message;
  } else if (msg.payload?.text) {
    return msg.payload.text;
  } else if (msg.payload?.content) {
    return msg.payload.content;
  }
  return JSON.stringify(msg.payload);
}

async function loadHistory(
  sessionId: string,
  memoryConfig: GeminiMemoryConfig | null,
  context: ExecutionContext,
  node: Node
): Promise<ConversationTurn[]> {
  if (!memoryConfig) return [];

  const memoryKey = `memory:${sessionId}`;

  try {
    if (memoryConfig.storageType === 'inmem') {
      return await context.storage.get(memoryKey) || [];
    } else if (memoryConfig.storageType === 'context-flow') {
      return await context.flow.get(memoryConfig.contextKey || memoryKey) || [];
    } else if (memoryConfig.storageType === 'context-global') {
      return await context.global.get(memoryConfig.contextKey || memoryKey) || [];
    }
  } catch (err) {
    node.warn(`Failed to load history: ${err}`);
  }

  return [];
}

async function saveHistory(
  sessionId: string,
  history: ConversationTurn[],
  memoryConfig: GeminiMemoryConfig | null,
  context: ExecutionContext,
  node: Node
): Promise<void> {
  if (!memoryConfig) return;

  const memoryKey = `memory:${sessionId}`;

  // Trim history if exceeds maxItems
  let trimmedHistory = history;
  if (history.length > memoryConfig.maxItems * 2) {
    trimmedHistory = history.slice(-(memoryConfig.maxItems * 2));
  }

  try {
    if (memoryConfig.storageType === 'inmem') {
      await context.storage.put(memoryKey, trimmedHistory);
    } else if (memoryConfig.storageType === 'context-flow') {
      await context.flow.set(memoryConfig.contextKey || memoryKey, trimmedHistory);
    } else if (memoryConfig.storageType === 'context-global') {
      await context.global.set(memoryConfig.contextKey || memoryKey, trimmedHistory);
    }
  } catch (err) {
    node.warn(`Failed to save history: ${err}`);
  }
}

async function discoverTools(node: Node, context: ExecutionContext): Promise<ToolRegistry> {
  const registry: ToolRegistry = {};
  const toolNodeIds = node.config.toolNodes || [];

  const flowEngine = context.flowEngine;
  if (!flowEngine) return registry;

  for (const toolNodeId of toolNodeIds) {
    const toolNode = flowEngine['nodes'].get(toolNodeId);
    if (!toolNode || toolNode.type !== 'gemini-tool-function') continue;
    if (!toolNode.config.enabled) continue;

    try {
      const parametersSchema = JSON.parse(toolNode.config.parametersSchema || '{}');
      const toolName = toolNode.config.toolName;

      if (!toolName) {
        node.warn(`Tool node ${toolNodeId} has no toolName`);
        continue;
      }

      registry[toolName] = {
        nodeId: toolNodeId,
        node: toolNode,
        declaration: {
          name: toolName,
          description: toolNode.config.description || '',
          parameters: {
            type: 'object',
            properties: parametersSchema.properties || {},
            required: parametersSchema.required || []
          }
        }
      };
    } catch (err) {
      node.warn(`Failed to load tool ${toolNodeId}: ${err}`);
    }
  }

  return registry;
}

async function callGeminiWithTools(options: {
  modelConfig: GeminiModelConfig;
  history: ConversationTurn[];
  systemInstruction: string;
  tools: ToolRegistry;
  maxIterations: number;
  node: Node;
  context: ExecutionContext;
  msg: NodeMessage;
}): Promise<{
  response: string;
  history: ConversationTurn[];
  functionCalls: FunctionCall[];
  tokensUsed: { prompt: number; completion: number; total: number };
}> {
  const { modelConfig, systemInstruction, tools, maxIterations, node, context, msg } = options;
  let history = [...options.history];
  const functionCalls: FunctionCall[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  // Build tool declarations for Gemini
  const toolDeclarations = Object.values(tools).map(t => ({
    function_declarations: [{
      name: t.declaration.name,
      description: t.declaration.description,
      parameters: t.declaration.parameters
    }]
  }));

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Call Gemini API
    const response = await callGeminiAPI({
      apiKey: modelConfig.apiKey!,
      model: modelConfig.model,
      history,
      systemInstruction,
      tools: toolDeclarations.length > 0 ? toolDeclarations : undefined,
      generationConfig: {
        temperature: modelConfig.temperature,
        topP: modelConfig.topP,
        topK: modelConfig.topK,
        maxOutputTokens: modelConfig.maxOutputTokens
      }
    });

    // Track tokens
    totalPromptTokens += response.promptTokens || 0;
    totalCompletionTokens += response.completionTokens || 0;

    // Check if response contains function calls
    if (response.functionCalls && response.functionCalls.length > 0) {
      // Execute each function call
      const functionResponses: any[] = [];

      for (const call of response.functionCalls) {
        functionCalls.push({ name: call.name, args: call.args });

        // Execute tool
        const result = await executeTool(
          tools[call.name],
          call.args,
          context,
          node,
          msg,
          history
        );

        functionResponses.push({
          name: call.name,
          response: result
        });
      }

      // Add function call and response to history
      history.push({
        role: 'model',
        parts: response.functionCalls.map(call => ({
          functionCall: {
            name: call.name,
            args: call.args
          }
        }))
      } as any);

      history.push({
        role: 'user',
        parts: functionResponses.map(fr => ({
          functionResponse: {
            name: fr.name,
            response: fr.response
          }
        }))
      } as any);

      // Continue loop to get final response
      continue;
    }

    // No more function calls - return final response
    if (response.text) {
      history.push({
        role: 'model',
        parts: [{ text: response.text }]
      });

      return {
        response: response.text,
        history,
        functionCalls,
        tokensUsed: {
          prompt: totalPromptTokens,
          completion: totalCompletionTokens,
          total: totalPromptTokens + totalCompletionTokens
        }
      };
    }

    // Safety fallback
    break;
  }

  // Max iterations reached
  return {
    response: 'Maximum function call iterations reached.',
    history,
    functionCalls,
    tokensUsed: {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
      total: totalPromptTokens + totalCompletionTokens
    }
  };
}

async function callGeminiAPI(options: {
  apiKey: string;
  model: string;
  history: ConversationTurn[];
  systemInstruction: string;
  tools?: any[];
  generationConfig: any;
}): Promise<{
  text?: string;
  functionCalls?: Array<{ name: string; args: any }>;
  promptTokens: number;
  completionTokens: number;
}> {
  const { apiKey, model, history, systemInstruction, tools, generationConfig } = options;

  const requestBody: any = {
    contents: history,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  // Parse response
  const candidate = data.candidates?.[0];
  const content = candidate?.content;
  const usageMetadata = data.usageMetadata || {};

  // Extract text or function calls
  const parts = content?.parts || [];
  const text = parts.find((p: any) => p.text)?.text;
  const functionCalls = parts
    .filter((p: any) => p.functionCall)
    .map((p: any) => ({
      name: p.functionCall.name,
      args: p.functionCall.args || {}
    }));

  return {
    text,
    functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
    promptTokens: usageMetadata.promptTokenCount || 0,
    completionTokens: usageMetadata.candidatesTokenCount || 0
  };
}

async function executeTool(
  tool: ToolRegistry[string] | undefined,
  args: Record<string, any>,
  context: ExecutionContext,
  agentNode: Node,
  msg: NodeMessage,
  history: ConversationTurn[]
): Promise<any> {
  if (!tool || !tool.node) {
    return { error: 'Tool not found' };
  }

  const toolNode = tool.node;
  const timeout = toolNode.config.timeout || 30000;

  try {
    // Build execution context
    const sandbox = {
      args,
      flow: context.flow,
      global: context.global,
      env: context.env,
      msg: RED.util.cloneMessage(msg),
      history: [...history],
      fetch,
      crypto,
      console,
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number
    };

    // Execute tool function
    const result = await executeSafeFunction(
      toolNode.config.functionCode,
      sandbox
    );

    return result || { success: true };

  } catch (err: any) {
    agentNode.warn(`Tool execution error (${tool.declaration.name}): ${err.message}`);
    return {
      error: true,
      message: err.message
    };
  }
}

// ===================================================================
// STANDARD TOOL NODES
// ===================================================================

registry.register('gemini-tool-calculator', {
  type: 'gemini-tool-calculator',
  category: 'function',
  color: '#FBBC04',
  defaults: {
    name: { value: 'Calculator' },
    toolName: { value: 'calculate' },
    description: { value: 'Perform mathematical calculations safely' },
    parametersSchema: {
      value: JSON.stringify({
        properties: {
          expression: {
            type: 'string',
            description: 'Mathematical expression to evaluate (e.g., "2 + 2", "5 * 10")'
          }
        },
        required: ['expression']
      })
    },
    functionCode: {
      value: `
const expr = args.expression;
// Safe evaluation - only allow numbers and operators
const safeExpr = expr.replace(/[^0-9+\\-*/.() ]/g, '');

try {
  const result = Function('"use strict"; return (' + safeExpr + ')')();
  return {
    expression: args.expression,
    result: result,
    success: true
  };
} catch (err) {
  return {
    error: 'Invalid mathematical expression',
    message: err.message
  };
}
      `.trim()
    },
    enabled: { value: true },
    requireConfirmation: { value: false },
    timeout: { value: 5000 }
  },
  inputs: 0,
  outputs: 0,
  icon: 'function.svg',
  label: function() {
    return this.name || 'Calculator Tool';
  },
  execute: async () => null
});

registry.register('gemini-tool-google-search', {
  type: 'gemini-tool-google-search',
  category: 'function',
  color: '#FBBC04',
  defaults: {
    name: { value: 'Google Search' },
    toolName: { value: 'google_search' },
    description: { value: 'Search Google for current information and web content' },
    parametersSchema: {
      value: JSON.stringify({
        properties: {
          query: {
            type: 'string',
            description: 'The search query'
          },
          numResults: {
            type: 'integer',
            description: 'Number of results to return (1-10)',
            default: 5
          }
        },
        required: ['query']
      })
    },
    functionCode: {
      value: `
const apiKey = env.GOOGLE_SEARCH_API_KEY;
const cx = env.GOOGLE_SEARCH_CX;

if (!apiKey || !cx) {
  return {
    error: 'Google Search API not configured',
    message: 'Set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX in environment'
  };
}

const numResults = Math.min(args.numResults || 5, 10);
const url = \`https://www.googleapis.com/customsearch/v1?key=\${apiKey}&cx=\${cx}&q=\${encodeURIComponent(args.query)}&num=\${numResults}\`;

try {
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.error) {
    return {
      error: 'Search API error',
      message: data.error.message
    };
  }
  
  return {
    query: args.query,
    results: data.items?.map(item => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet
    })) || [],
    totalResults: data.searchInformation?.totalResults || 0
  };
} catch (err) {
  return {
    error: 'Search failed',
    message: err.message
  };
}
      `.trim()
    },
    enabled: { value: true },
    requireConfirmation: { value: false },
    timeout: { value: 10000 }
  },
  inputs: 0,
  outputs: 0,
  icon: 'function.svg',
  label: function() {
    return this.name || 'Google Search Tool';
  },
  execute: async () => null
});

registry.register('gemini-tool-web-scrape', {
  type: 'gemini-tool-web-scrape',
  category: 'function',
  color: '#FBBC04',
  defaults: {
    name: { value: 'Web Scraper' },
    toolName: { value: 'scrape_webpage' },
    description: { value: 'Extract text content from a webpage URL' },
    parametersSchema: {
      value: JSON.stringify({
        properties: {
          url: {
            type: 'string',
            description: 'The URL to scrape'
          },
          maxLength: {
            type: 'integer',
            description: 'Maximum content length in characters',
            default: 5000
          }
        },
        required: ['url']
      })
    },
    functionCode: {
      value: `
try {
  const response = await fetch(args.url);
  
  if (!response.ok) {
    return {
      error: 'Failed to fetch URL',
      status: response.status
    };
  }
  
  const html = await response.text();
  
  // Remove scripts and styles
  let text = html.replace(/<script[^>]*>.*?<\\/script>/gi, '');
  text = text.replace(/<style[^>]*>.*?<\\/style>/gi, '');
  
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  
  // Clean whitespace
  text = text.replace(/\\s+/g, ' ').trim();
  
  // Limit length
  const maxLength = args.maxLength || 5000;
  const truncated = text.length > maxLength;
  text = text.substring(0, maxLength);
  
  return {
    url: args.url,
    content: text,
    length: text.length,
    truncated: truncated,
    originalLength: html.length
  };
} catch (err) {
  return {
    error: 'Scraping failed',
    message: err.message
  };
}
      `.trim()
    },
    enabled: { value: true },
    requireConfirmation: { value: false },
    timeout: { value: 15000 }
  },
  inputs: 0,
  outputs: 0,
  icon: 'function.svg',
  label: function() {
    return this.name || 'Web Scraper Tool';
  },
  execute: async () => null
});

registry.register('gemini-tool-storage', {
  type: 'gemini-tool-storage',
  category: 'function',
  color: '#FBBC04',
  defaults: {
    name: { value: 'Storage' },
    toolName: { value: 'store_data' },
    description: { value: 'Store and retrieve data in flow or global context' },
    parametersSchema: {
      value: JSON.stringify({
        properties: {
          action: {
            type: 'string',
            enum: ['set', 'get', 'delete', 'list'],
            description: 'Action to perform'
          },
          key: {
            type: 'string',
            description: 'Storage key'
          },
          value: {
            type: 'string',
            description: 'Value to store (for set action)'
          },
          scope: {
            type: 'string',
            enum: ['flow', 'global'],
            default: 'flow',
            description: 'Storage scope'
          }
        },
        required: ['action']
      })
    },
    functionCode: {
      value: `
const store = args.scope === 'global' ? global : flow;
const action = args.action;

try {
  if (action === 'set') {
    if (!args.key || args.value === undefined) {
      return { error: 'key and value required for set' };
    }
    await store.set(args.key, args.value);
    return {
      success: true,
      action: 'set',
      key: args.key,
      scope: args.scope || 'flow'
    };
  } else if (action === 'get') {
    if (!args.key) {
      return { error: 'key required for get' };
    }
    const value = await store.get(args.key);
    return {
      success: true,
      action: 'get',
      key: args.key,
      value: value,
      scope: args.scope || 'flow'
    };
  } else if (action === 'delete') {
    if (!args.key) {
      return { error: 'key required for delete' };
    }
    // Note: No direct delete in context interface, but we can set to null
    await store.set(args.key, null);
    return {
      success: true,
      action: 'delete',
      key: args.key,
      scope: args.scope || 'flow'
    };
  } else if (action === 'list') {
    const keys = await store.keys();
    return {
      success: true,
      action: 'list',
      keys: keys,
      count: keys.length,
      scope: args.scope || 'flow'
    };
  } else {
    return { error: 'Invalid action. Use set, get, delete, or list' };
  }
} catch (err) {
  return {
    error: 'Storage operation failed',
    message: err.message
  };
}
      `.trim()
    },
    enabled: { value: true },
    requireConfirmation: { value: false },
    timeout: { value: 5000 }
  },
  inputs: 0,
  outputs: 0,
  icon: 'function.svg',
  label: function() {
    return this.name || 'Storage Tool';
  },
  execute: async () => null
});

registry.register('gemini-tool-datetime', {
  type: 'gemini-tool-datetime',
  category: 'function',
  color: '#FBBC04',
  defaults: {
    name: { value: 'Date & Time' },
    toolName: { value: 'get_datetime' },
    description: { value: 'Get current date, time, and timezone information' },
    parametersSchema: {
      value: JSON.stringify({
        properties: {
          format: {
            type: 'string',
            enum: ['iso', 'locale', 'unix', 'detailed'],
            default: 'detailed',
            description: 'Output format'
          },
          timezone: {
            type: 'string',
            description: 'Timezone (e.g., "America/New_York", "UTC")',
            default: 'UTC'
          }
        },
        required: []
      })
    },
    functionCode: {
      value: `
const now = new Date();
const format = args.format || 'detailed';
const timezone = args.timezone || 'UTC';

try {
  if (format === 'iso') {
    return {
      datetime: now.toISOString(),
      format: 'iso'
    };
  } else if (format === 'unix') {
    return {
      timestamp: Math.floor(now.getTime() / 1000),
      milliseconds: now.getTime(),
      format: 'unix'
    };
  } else if (format === 'locale') {
    return {
      datetime: now.toLocaleString('en-US', { timeZone: timezone }),
      timezone: timezone,
      format: 'locale'
    };
  } else {
    // Detailed format
    return {
      iso: now.toISOString(),
      unix: Math.floor(now.getTime() / 1000),
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      day: now.getUTCDate(),
      hour: now.getUTCHours(),
      minute: now.getUTCMinutes(),
      second: now.getUTCSeconds(),
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getUTCDay()],
      timezone: 'UTC',
      formatted: now.toUTCString()
    };
  }
} catch (err) {
  return {
    error: 'Failed to get datetime',
    message: err.message
  };
}
      `.trim()
    },
    enabled: { value: true },
    requireConfirmation: { value: false },
    timeout: { value: 1000 }
  },
  inputs: 0,
  outputs: 0,
  icon: 'function.svg',
  label: function() {
    return this.name || 'Date & Time Tool';
  },
  execute: async () => null
});

registry.register('gemini-tool-json-parser', {
  type: 'gemini-tool-json-parser',
  category: 'function',
  color: '#FBBC04',
  defaults: {
    name: { value: 'JSON Parser' },
    toolName: { value: 'parse_json' },
    description: { value: 'Parse and validate JSON strings, or stringify objects' },
    parametersSchema: {
      value: JSON.stringify({
        properties: {
          action: {
            type: 'string',
            enum: ['parse', 'stringify'],
            description: 'Parse JSON string or stringify object'
          },
          data: {
            type: 'string',
            description: 'JSON string to parse or object to stringify'
          },
          pretty: {
            type: 'boolean',
            default: false,
            description: 'Pretty print output (for stringify)'
          }
        },
        required: ['action', 'data']
      })
    },
    functionCode: {
      value: `
try {
  if (args.action === 'parse') {
    const parsed = JSON.parse(args.data);
    return {
      success: true,
      action: 'parse',
      result: parsed,
      type: typeof parsed
    };
  } else if (args.action === 'stringify') {
    // If data is already a string, try to parse it first
    let obj = args.data;
    if (typeof args.data === 'string') {
      try {
        obj = JSON.parse(args.data);
      } catch {
        // Not JSON, treat as object
      }
    }
    
    const stringified = args.pretty 
      ? JSON.stringify(obj, null, 2)
      : JSON.stringify(obj);
      
    return {
      success: true,
      action: 'stringify',
      result: stringified,
      length: stringified.length
    };
  } else {
    return {
      error: 'Invalid action',
      message: 'Use "parse" or "stringify"'
    };
  }
} catch (err) {
  return {
    error: 'JSON operation failed',
    message: err.message,
    action: args.action
  };
}
      `.trim()
    },
    enabled: { value: true },
    requireConfirmation: { value: false },
    timeout: { value: 5000 }
  },
  inputs: 0,
  outputs: 0,
  icon: 'function.svg',
  label: function() {
    return this.name || 'JSON Parser Tool';
  },
  execute: async () => null
});

registry.register('gemini-tool-http-request', {
  type: 'gemini-tool-http-request',
  category: 'function',
  color: '#FBBC04',
  defaults: {
    name: { value: 'HTTP Request' },
    toolName: { value: 'http_request' },
    description: { value: 'Make HTTP requests to external APIs' },
    parametersSchema: {
      value: JSON.stringify({
        properties: {
          url: {
            type: 'string',
            description: 'URL to request'
          },
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
            default: 'GET',
            description: 'HTTP method'
          },
          body: {
            type: 'string',
            description: 'Request body (JSON string for POST/PUT/PATCH)'
          },
          headers: {
            type: 'object',
            description: 'Custom headers'
          }
        },
        required: ['url']
      })
    },
    functionCode: {
      value: `
try {
  const method = args.method || 'GET';
  const headers = args.headers || {};
  
  // Add content-type for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(method) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  
  const options = {
    method: method,
    headers: headers
  };
  
  // Add body for non-GET requests
  if (args.body && method !== 'GET') {
    options.body = args.body;
  }
  
  const response = await fetch(args.url, options);
  
  // Parse response
  const contentType = response.headers.get('content-type') || '';
  let data;
  
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }
  
  return {
    success: response.ok,
    status: response.status,
    statusText: response.statusText,
    data: data,
    headers: Object.fromEntries(response.headers),
    url: args.url,
    method: method
  };
} catch (err) {
  return {
    error: 'HTTP request failed',
    message: err.message,
    url: args.url
  };
}
      `.trim()
    },
    enabled: { value: true },
    requireConfirmation: { value: false },
    timeout: { value: 30000 }
  },
  inputs: 0,
  outputs: 0,
  icon: 'function.svg',
  label: function() {
    return this.name || 'HTTP Request Tool';
  },
  execute: async () => null
});

registry.register('gemini-tool-random', {
  type: 'gemini-tool-random',
  category: 'function',
  color: '#FBBC04',
  defaults: {
    name: { value: 'Random Generator' },
    toolName: { value: 'generate_random' },
    description: { value: 'Generate random numbers, strings, or UUIDs' },
    parametersSchema: {
      value: JSON.stringify({
        properties: {
          type: {
            type: 'string',
            enum: ['number', 'integer', 'string', 'uuid'],
            description: 'Type of random value to generate'
          },
          min: {
            type: 'number',
            description: 'Minimum value (for number/integer)',
            default: 0
          },
          max: {
            type: 'number',
            description: 'Maximum value (for number/integer)',
            default: 100
          },
          length: {
            type: 'integer',
            description: 'Length of string (for string type)',
            default: 10
          }
        },
        required: ['type']
      })
    },
    functionCode: {
      value: `
try {
  const type = args.type;
  
  if (type === 'uuid') {
    return {
      type: 'uuid',
      value: crypto.randomUUID()
    };
  } else if (type === 'number') {
    const min = args.min || 0;
    const max = args.max || 100;
    const value = Math.random() * (max - min) + min;
    return {
      type: 'number',
      value: value,
      min: min,
      max: max
    };
  } else if (type === 'integer') {
    const min = Math.floor(args.min || 0);
    const max = Math.floor(args.max || 100);
    const value = Math.floor(Math.random() * (max - min + 1)) + min;
    return {
      type: 'integer',
      value: value,
      min: min,
      max: max
    };
  } else if (type === 'string') {
    const length = args.length || 10;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return {
      type: 'string',
      value: result,
      length: length
    };
  } else {
    return {
      error: 'Invalid type',
      message: 'Use number, integer, string, or uuid'
    };
  }
} catch (err) {
  return {
    error: 'Random generation failed',
    message: err.message
  };
}
      `.trim()
    },
    enabled: { value: true },
    requireConfirmation: { value: false },
    timeout: { value: 1000 }
  },
  inputs: 0,
  outputs: 0,
  icon: 'function.svg',
  label: function() {
    return this.name || 'Random Generator Tool';
  },
  execute: async () => null
});

// ===================================================================
// UTILITY NODES FOR CONVERSATION MANAGEMENT
// ===================================================================

registry.register('gemini-clear-history', {
  type: 'gemini-clear-history',
  category: 'function',
  color: '#EA4335',
  defaults: {
    name: { value: '' },
    sessionMode: { value: 'auto' },
    memoryConfigNode: { value: '' }
  },
  inputs: 1,
  outputs: 1,
  icon: 'icon.svg',
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    try {
      const sessionId = getSessionId(msg, node.config.sessionMode);
      const memoryConfig = await getMemoryConfig(node, context);
      
      if (!memoryConfig) {
        node.warn('No memory config found');
        return msg;
      }
      
      const memoryKey = `memory:${sessionId}`;
      
      // Clear history based on storage type
      if (memoryConfig.storageType === 'inmem') {
        await context.storage.delete(memoryKey);
      } else if (memoryConfig.storageType === 'context-flow') {
        await context.flow.set(memoryConfig.contextKey || memoryKey, []);
      } else if (memoryConfig.storageType === 'context-global') {
        await context.global.set(memoryConfig.contextKey || memoryKey, []);
      }
      
      msg.payload = {
        success: true,
        message: 'Conversation history cleared',
        sessionId: sessionId
      };
      
      node.status({ fill: 'green', shape: 'dot', text: 'History cleared' });
      return msg;
      
    } catch (err: any) {
      node.error(`Failed to clear history: ${err.message}`, msg);
      return null;
    }
  }
});

registry.register('gemini-get-history', {
  type: 'gemini-get-history',
  category: 'function',
  color: '#34A853',
  defaults: {
    name: { value: '' },
    sessionMode: { value: 'auto' },
    memoryConfigNode: { value: '' },
    format: { value: 'full' }
  },
  inputs: 1,
  outputs: 1,
  icon: 'icon.svg',
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    try {
      const sessionId = getSessionId(msg, node.config.sessionMode);
      const memoryConfig = await getMemoryConfig(node, context);
      
      if (!memoryConfig) {
        node.warn('No memory config found');
        return msg;
      }
      
      const history = await loadHistory(sessionId, memoryConfig, context, node);
      
      if (node.config.format === 'text') {
        // Convert to readable text format
        const text = history.map(turn => {
          const role = turn.role === 'user' ? 'User' : 'Assistant';
          const content = turn.parts.map(p => (p as any).text || '[function call]').join(' ');
          return `${role}: ${content}`;
        }).join('\n\n');
        
        msg.payload = text;
      } else if (node.config.format === 'summary') {
        // Just count and basic info
        msg.payload = {
          sessionId: sessionId,
          turns: history.length,
          lastUpdate: new Date().toISOString()
        };
      } else {
        // Full history
        msg.payload = {
          sessionId: sessionId,
          history: history,
          turns: history.length
        };
      }
      
      node.status({ 
        fill: 'green', 
        shape: 'dot', 
        text: `${history.length} turns` 
      });
      return msg;
      
    } catch (err: any) {
      node.error(`Failed to get history: ${err.message}`, msg);
      return null;
    }
  }
});

// ===================================================================
// Export for verification
// ===================================================================

export const GEMINI_NODES = [
  'gemini-model-config',
  'gemini-memory-inmem',
  'gemini-memory-context',
  'gemini-agent',
  'gemini-tool-function',
  'gemini-tool-calculator',
  'gemini-tool-google-search',
  'gemini-tool-web-scrape',
  'gemini-tool-storage',
  'gemini-tool-datetime',
  'gemini-tool-json-parser',
  'gemini-tool-http-request',
  'gemini-tool-random',
  'gemini-clear-history',
  'gemini-get-history'
];

console.log(`[RedNox] Registered ${GEMINI_NODES.length} Gemini nodes`);
