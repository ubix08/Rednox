// ===================================================================
// RedNox Gemini Nodes - Server-Side with @google/genai SDK
// ===================================================================

import { registry } from '../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext } from '../types/core';
import { RED } from '../utils';
import { GoogleGenAI } from '@google/genai';

// ===================================================================
// GEMINI AGENT NODE
// ===================================================================

registry.register('gemini-agent', {
  type: 'gemini-agent',
  category: 'AI',
  defaults: {
    name: { value: '' },
    apiKey: { value: '' },
    model: { value: 'gemini-2.0-flash-exp' },
    systemInstruction: { value: '' },
    temperature: { value: 1.0 },
    topP: { value: 0.95 },
    topK: { value: 64 },
    maxOutputTokens: { value: 8192 },
    enableVision: { value: true },
    memoryEnabled: { value: true },
    maxMemoryItems: { value: 20 }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const apiKey = node.config.apiKey;
    
    if (!apiKey) {
      node.error('API Key is required', msg);
      return null;
    }
    
    try {
      node.status({ fill: 'yellow', shape: 'dot', text: 'processing' });
      
      // Initialize Google GenAI client
      const ai = new GoogleGenAI({ apiKey });
      
      // Prepare conversation history
      const conversationId = msg.conversationId || msg._msgid || 'default';
      const memoryKey = `gemini_history_${conversationId}`;
      
      let history: any[] = [];
      if (node.config.memoryEnabled) {
        history = await node.context().get(memoryKey) || [];
      }
      
      // Prepare content parts
      const parts: any[] = [];
      
      // Add text content
      if (msg.payload && typeof msg.payload === 'string') {
        parts.push({ text: msg.payload });
      }
      
      // Add images if vision is enabled
      if (node.config.enableVision && msg.images && Array.isArray(msg.images)) {
        for (const image of msg.images) {
          if (image.data && image.mimeType) {
            parts.push({
              inlineData: {
                data: image.data.replace(/^data:.*?;base64,/, ''),
                mimeType: image.mimeType
              }
            });
          }
        }
      }
      
      // Add files
      if (msg.files && Array.isArray(msg.files)) {
        for (const file of msg.files) {
          if (file.data && file.mimeType) {
            parts.push({
              inlineData: {
                data: file.data.replace(/^data:.*?;base64,/, ''),
                mimeType: file.mimeType
              }
            });
          }
        }
      }
      
      if (parts.length === 0) {
        parts.push({ text: msg.payload || '' });
      }
      
      // Build contents array with history
      const contents = [
        ...history,
        {
          role: 'user',
          parts
        }
      ];
      
      // Prepare generation config
      const config: any = {
        temperature: node.config.temperature || 1.0,
        topP: node.config.topP || 0.95,
        topK: node.config.topK || 64,
        maxOutputTokens: node.config.maxOutputTokens || 8192
      };
      
      // Build request
      const request: any = {
        model: node.config.model || 'gemini-2.0-flash-exp',
        contents,
        config
      };
      
      // Add system instruction if provided
      if (node.config.systemInstruction && node.config.systemInstruction.trim()) {
        request.systemInstruction = {
          parts: [{ text: node.config.systemInstruction }]
        };
      }
      
      // Generate content
      let response;
      try {
        response = await ai.models.generateContent(request);
      } catch (error: any) {
        // Handle safety blocking
        if (error.message && error.message.toLowerCase().includes('safety')) {
          node.status({ fill: 'red', shape: 'dot', text: 'safety blocked' });
          return {
            ...msg,
            payload: null,
            error: 'Content was blocked by safety filters',
            gemini: {
              error: 'SAFETY_BLOCKED',
              message: error.message
            }
          };
        }
        throw error;
      }
      
      // Extract response text
      const responseText = response.text;
      
      // Update memory if enabled
      if (node.config.memoryEnabled) {
        history.push({
          role: 'user',
          parts
        });
        
        history.push({
          role: 'model',
          parts: [{ text: responseText }]
        });
        
        // Trim to max items (keep message pairs)
        const maxItems = node.config.maxMemoryItems || 20;
        if (history.length > maxItems * 2) {
          const excessPairs = Math.floor((history.length - maxItems * 2) / 2);
          history = history.slice(excessPairs * 2);
        }
        
        await node.context().set(memoryKey, history);
      }
      
      node.status({ fill: 'green', shape: 'dot', text: 'complete' });
      
      return {
        ...msg,
        payload: responseText,
        conversationId,
        gemini: {
          usageMetadata: response.usageMetadata || {},
          modelVersion: node.config.model
        }
      };
      
    } catch (err: any) {
      node.error(`Gemini API Error: ${err.message}`, msg);
      node.status({ fill: 'red', shape: 'dot', text: 'error' });
      
      return {
        ...msg,
        payload: null,
        error: err.message,
        gemini: {
          error: 'API_ERROR',
          message: err.message
        }
      };
    }
  },
  
  ui: {
    icon: '🧠',
    color: '#4285F4',
    colorLight: '#669DF6',
    paletteLabel: 'Gemini',
    label: (node) => node.name || 'Gemini Agent',
    info: `
      <h3>Gemini Agent</h3>
      <p>AI Agent using Google GenAI SDK (@google/genai).</p>
      
      <h4>Inputs:</h4>
      <ul>
        <li><code>msg.payload</code> - User message (string)</li>
        <li><code>msg.images</code> - Array of images with data (base64) and mimeType</li>
        <li><code>msg.files</code> - Array of files with data (base64) and mimeType</li>
        <li><code>msg.conversationId</code> - Optional conversation ID for memory</li>
      </ul>
      
      <h4>Outputs:</h4>
      <ul>
        <li><code>msg.payload</code> - AI response text</li>
        <li><code>msg.conversationId</code> - Conversation identifier</li>
        <li><code>msg.gemini</code> - Metadata (usageMetadata, modelVersion)</li>
      </ul>
    `,
    properties: [
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: '',
        placeholder: 'Gemini Agent'
      },
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        description: 'Get from AI Studio (https://aistudio.google.com/app/apikey)'
      },
      {
        name: 'model',
        label: 'Model',
        type: 'select',
        options: [
          { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash (Experimental)' },
          { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
          { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
          { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
          { value: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash-8B' }
        ],
        default: 'gemini-2.0-flash-exp'
      },
      {
        name: 'systemInstruction',
        label: 'System Instruction',
        type: 'textarea',
        rows: 4,
        default: '',
        placeholder: 'You are a helpful assistant...'
      },
      {
        name: 'temperature',
        label: 'Temperature',
        type: 'number',
        default: 1.0,
        min: 0,
        max: 2,
        step: 0.1
      },
      {
        name: 'topP',
        label: 'Top P',
        type: 'number',
        default: 0.95,
        min: 0,
        max: 1,
        step: 0.01
      },
      {
        name: 'topK',
        label: 'Top K',
        type: 'number',
        default: 64,
        min: 1,
        max: 100
      },
      {
        name: 'maxOutputTokens',
        label: 'Max Output Tokens',
        type: 'number',
        default: 8192,
        min: 1,
        max: 8192
      },
      {
        name: 'enableVision',
        label: 'Enable Vision',
        type: 'checkbox',
        default: true
      },
      {
        name: 'memoryEnabled',
        label: 'Enable Memory',
        type: 'checkbox',
        default: true
      },
      {
        name: 'maxMemoryItems',
        label: 'Max Memory Items',
        type: 'number',
        default: 20,
        min: 1,
        max: 100
      }
    ]
  }
});

// ===================================================================
// GEMINI STREAMING NODE
// ===================================================================

registry.register('gemini-stream', {
  type: 'gemini-stream',
  category: 'AI',
  defaults: {
    name: { value: '' },
    apiKey: { value: '' },
    model: { value: 'gemini-2.0-flash-exp' },
    systemInstruction: { value: '' },
    temperature: { value: 1.0 },
    topP: { value: 0.95 },
    topK: { value: 64 },
    maxOutputTokens: { value: 8192 }
  },
  inputs: 1,
  outputs: 2,
  
  execute: async (msg: NodeMessage, node: Node) => {
    const apiKey = node.config.apiKey;
    
    if (!apiKey) {
      node.error('API Key is required', msg);
      return null;
    }
    
    try {
      node.status({ fill: 'yellow', shape: 'dot', text: 'streaming' });
      
      const ai = new GoogleGenAI({ apiKey });
      
      // Prepare content
      const parts: any[] = [];
      if (msg.payload && typeof msg.payload === 'string') {
        parts.push({ text: msg.payload });
      } else {
        parts.push({ text: String(msg.payload || '') });
      }
      
      // Build request
      const request: any = {
        model: node.config.model || 'gemini-2.0-flash-exp',
        contents: [{
          role: 'user',
          parts
        }],
        config: {
          temperature: node.config.temperature || 1.0,
          topP: node.config.topP || 0.95,
          topK: node.config.topK || 64,
          maxOutputTokens: node.config.maxOutputTokens || 8192
        }
      };
      
      if (node.config.systemInstruction && node.config.systemInstruction.trim()) {
        request.systemInstruction = {
          parts: [{ text: node.config.systemInstruction }]
        };
      }
      
      // Stream response
      const stream = await ai.models.generateContentStream(request);
      
      let fullText = '';
      const chunks: NodeMessage[] = [];
      
      for await (const chunk of stream) {
        const chunkText = chunk.text || '';
        fullText += chunkText;
        
        // Send chunk to first output
        const chunkMsg: NodeMessage = {
          ...msg,
          payload: chunkText,
          chunk: true,
          complete: false
        };
        chunks.push(chunkMsg);
      }
      
      node.status({ fill: 'green', shape: 'dot', text: 'complete' });
      
      // Send all chunks to first output, final to second output
      const finalMsg: NodeMessage = {
        ...msg,
        payload: fullText,
        chunk: false,
        complete: true,
        gemini: {
          modelVersion: node.config.model
        }
      };
      
      return [chunks, finalMsg];
      
    } catch (err: any) {
      node.error(`Gemini Streaming Error: ${err.message}`, msg);
      node.status({ fill: 'red', shape: 'dot', text: 'error' });
      return null;
    }
  },
  
  ui: {
    icon: '📡',
    color: '#4285F4',
    colorLight: '#669DF6',
    paletteLabel: 'Gemini Stream',
    label: (node) => node.name || 'Gemini Stream',
    info: `
      <h3>Gemini Stream</h3>
      <p>Stream responses from Gemini API.</p>
      
      <h4>Outputs:</h4>
      <ol>
        <li>Stream chunks - each chunk as it arrives</li>
        <li>Complete response - final aggregated text</li>
      </ol>
    `,
    properties: [
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: ''
      },
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true
      },
      {
        name: 'model',
        label: 'Model',
        type: 'select',
        options: [
          { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash (Experimental)' },
          { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }
        ],
        default: 'gemini-2.0-flash-exp'
      },
      {
        name: 'systemInstruction',
        label: 'System Instruction',
        type: 'textarea',
        rows: 4,
        default: ''
      },
      {
        name: 'temperature',
        label: 'Temperature',
        type: 'number',
        default: 1.0,
        min: 0,
        max: 2,
        step: 0.1
      }
    ]
  }
});

// ===================================================================
// GEMINI CLEAR MEMORY NODE
// ===================================================================

registry.register('gemini-clear-memory', {
  type: 'gemini-clear-memory',
  category: 'AI',
  defaults: {
    name: { value: '' },
    conversationId: { value: '' }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node) => {
    const conversationId = node.config.conversationId || msg.conversationId || 'default';
    const memoryKey = `gemini_history_${conversationId}`;
    
    try {
      await node.context().set(memoryKey, []);
      
      node.status({ fill: 'green', shape: 'dot', text: 'cleared' });
      
      return {
        ...msg,
        payload: `Memory cleared for conversation: ${conversationId}`,
        conversationId
      };
    } catch (err: any) {
      node.error(`Failed to clear memory: ${err.message}`, msg);
      return {
        ...msg,
        error: err.message
      };
    }
  },
  
  ui: {
    icon: '🗑️',
    color: '#FF6B6B',
    colorLight: '#FF8787',
    paletteLabel: 'Clear Memory',
    align: 'right',
    label: (node) => node.name || 'Clear Memory',
    info: `
      <h3>Clear Gemini Memory</h3>
      <p>Clears conversation history.</p>
    `,
    properties: [
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: ''
      },
      {
        name: 'conversationId',
        label: 'Conversation ID',
        type: 'text',
        default: '',
        placeholder: 'Leave empty to use msg.conversationId'
      }
    ]
  }
});

// ===================================================================
// GEMINI IMAGE ENCODER NODE
// ===================================================================

registry.register('gemini-image-encoder', {
  type: 'gemini-image-encoder',
  category: 'AI',
  defaults: {
    name: { value: '' },
    sourceProperty: { value: 'payload' }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node) => {
    const sourceProp = node.config.sourceProperty || 'payload';
    const source = RED.util.getMessageProperty(msg, sourceProp);
    
    if (!source) {
      node.error('No image data found', msg);
      return null;
    }
    
    try {
      let imageData: string;
      let mimeType: string;
      
      if (typeof source === 'string') {
        if (source.startsWith('data:')) {
          const matches = source.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            mimeType = matches[1];
            imageData = matches[2];
          } else {
            throw new Error('Invalid data URI format');
          }
        } else if (source.startsWith('http')) {
          node.status({ fill: 'yellow', shape: 'dot', text: 'fetching' });
          
          const response = await fetch(source);
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status}`);
          }
          
          const arrayBuffer = await response.arrayBuffer();
          mimeType = response.headers.get('content-type') || 'image/jpeg';
          
          // Convert to base64
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          imageData = btoa(binary);
        } else {
          throw new Error('Invalid image source');
        }
      } else {
        throw new Error('Unsupported image format');
      }
      
      if (!msg.images) {
        msg.images = [];
      }
      
      msg.images.push({
        data: imageData,
        mimeType: mimeType || 'image/jpeg'
      });
      
      node.status({ fill: 'green', shape: 'dot', text: 'encoded' });
      
      return msg;
      
    } catch (err: any) {
      node.error(`Image encoding error: ${err.message}`, msg);
      node.status({ fill: 'red', shape: 'dot', text: 'error' });
      return null;
    }
  },
  
  ui: {
    icon: '🖼️',
    color: '#9B59B6',
    colorLight: '#BB8FCE',
    paletteLabel: 'Encode Image',
    label: (node) => node.name || 'Encode Image',
    info: `
      <h3>Gemini Image Encoder</h3>
      <p>Encodes images for Gemini vision models.</p>
      
      <h4>Supported Formats:</h4>
      <ul>
        <li>HTTP/HTTPS URLs</li>
        <li>Data URIs (data:image/...;base64,...)</li>
      </ul>
    `,
    properties: [
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: ''
      },
      {
        name: 'sourceProperty',
        label: 'Source Property',
        type: 'text',
        default: 'payload'
      }
    ]
  }
});

// ===================================================================
// GEMINI FUNCTION CALLING NODE
// ===================================================================

registry.register('gemini-function-call', {
  type: 'gemini-function-call',
  category: 'AI',
  defaults: {
    name: { value: '' },
    apiKey: { value: '' },
    model: { value: 'gemini-2.5-flash' },
    functions: { value: [] },
    systemInstruction: { value: '' }
  },
  inputs: 1,
  outputs: 2,
  
  execute: async (msg: NodeMessage, node: Node) => {
    const apiKey = node.config.apiKey;
    
    if (!apiKey) {
      node.error('API Key is required', msg);
      return null;
    }
    
    try {
      node.status({ fill: 'yellow', shape: 'dot', text: 'processing' });
      
      const ai = new GoogleGenAI({ apiKey });
      
      // Prepare function declarations
      const functionDeclarations = node.config.functions || [];
      
      // Build request
      const request: any = {
        model: node.config.model || 'gemini-2.5-flash',
        contents: [{
          role: 'user',
          parts: [{ text: msg.payload || '' }]
        }],
        config: {
          tools: functionDeclarations.length > 0 ? [{
            functionDeclarations
          }] : undefined
        }
      };
      
      if (node.config.systemInstruction) {
        request.systemInstruction = {
          parts: [{ text: node.config.systemInstruction }]
        };
      }
      
      const response = await ai.models.generateContent(request);
      
      // Check for function calls
      const functionCalls = response.functionCalls || [];
      
      if (functionCalls.length > 0) {
        // Send function calls to first output
        const functionMsg: NodeMessage = {
          ...msg,
          payload: functionCalls,
          functionCalls: functionCalls
        };
        
        node.status({ fill: 'blue', shape: 'dot', text: 'function call' });
        return [functionMsg, null];
      } else {
        // Send text response to second output
        const textMsg: NodeMessage = {
          ...msg,
          payload: response.text,
          gemini: response
        };
        
        node.status({ fill: 'green', shape: 'dot', text: 'complete' });
        return [null, textMsg];
      }
      
    } catch (err: any) {
      node.error(`Gemini Function Call Error: ${err.message}`, msg);
      node.status({ fill: 'red', shape: 'dot', text: 'error' });
      return null;
    }
  },
  
  ui: {
    icon: '⚙️',
    color: '#E67E22',
    colorLight: '#F39C12',
    paletteLabel: 'Function Call',
    label: (node) => node.name || 'Function Call',
    info: `
      <h3>Gemini Function Calling</h3>
      <p>Enable function calling with Gemini.</p>
      
      <h4>Outputs:</h4>
      <ol>
        <li>Function calls - when AI wants to call a function</li>
        <li>Text response - when AI responds with text</li>
      </ol>
    `,
    properties: [
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: ''
      },
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true
      },
      {
        name: 'model',
        label: 'Model',
        type: 'select',
        options: [
          { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
          { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }
        ],
        default: 'gemini-2.5-flash'
      },
      {
        name: 'systemInstruction',
        label: 'System Instruction',
        type: 'textarea',
        rows: 4,
        default: ''
      },
      {
        name: 'functions',
        label: 'Function Declarations',
        type: 'json',
        default: []
      }
    ]
  }
});
