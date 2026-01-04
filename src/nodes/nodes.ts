
// ===================================================================
// Sample Enhanced Nodes with Complete UI Metadata
// ===================================================================

import { registry } from '../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext } from '../types/core';
import { RED } from '../utils';

// ===================================================================
// HTTP-IN NODE (Full Example)
// ===================================================================

registry.register('http-in', {
  type: 'http-in',
  category: 'input',
  defaults: { 
    method: { value: 'post' }, 
    url: { value: '/' }, 
    name: { value: '' } 
  },
  inputs: 0,
  outputs: 1,
  
  execute: async (msg: NodeMessage) => msg,
  
  ui: {
    icon: '🌐',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'HTTP In',
    label: (node) => {
      if (node.name) return node.name;
      const method = (node.method || 'GET').toUpperCase();
      const url = node.url || '/';
      return `[${method}] ${url}`;
    },
    info: `
      <h3>HTTP In</h3>
      <p>Creates an HTTP endpoint that can be called to trigger the flow.</p>
      <p>The URL will be available at <code>/api/{flow-id}{url}</code></p>
      <h4>Outputs:</h4>
      <ul>
        <li><code>msg.payload</code> - Request body (for POST/PUT) or query params (for GET)</li>
        <li><code>msg.req</code> - Request metadata (headers, method, url)</li>
      </ul>
    `,
    properties: [
      {
        name: 'method',
        label: 'Method',
        type: 'select',
        options: [
          { value: 'get', label: 'GET' },
          { value: 'post', label: 'POST' },
          { value: 'put', label: 'PUT' },
          { value: 'delete', label: 'DELETE' },
          { value: 'patch', label: 'PATCH' }
        ],
        default: 'post',
        required: true,
        description: 'HTTP method for this endpoint'
      },
      {
        name: 'url',
        label: 'URL',
        type: 'text',
        default: '/',
        required: true,
        placeholder: '/endpoint',
        description: 'URL path for this endpoint (without flow-id prefix)'
      },
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: '',
        placeholder: 'Optional node name'
      }
    ]
  }
});

// ===================================================================
// HTTP RESPONSE NODE
// ===================================================================

registry.register('http-response', {
  type: 'http-response',
  category: 'output',
  defaults: { 
    name: { value: '' }, 
    statusCode: { value: '' }, 
    headers: { value: {} } 
  },
  inputs: 1,
  outputs: 0,
  
  execute: async (msg: NodeMessage, node: Node) => {
    let payload = msg.payload;
    let contentType = 'application/json';
    
    if (typeof payload === 'string') {
      contentType = payload.trim().startsWith('<') ? 'text/html' : 'text/plain';
    } else if (payload instanceof Uint8Array || payload instanceof ArrayBuffer) {
      contentType = 'application/octet-stream';
    }
    
    if (msg.headers?.['content-type']) {
      contentType = msg.headers['content-type'];
    }
    
    if (typeof payload === 'object' && contentType.includes('json')) {
      payload = JSON.stringify(payload);
    }
    
    msg._httpResponse = {
      statusCode: node.config.statusCode || msg.statusCode || 200,
      headers: {
        'Content-Type': contentType,
        ...node.config.headers,
        ...msg.headers
      },
      payload
    };
    return null;
  },
  
  ui: {
    icon: '📤',
    color: '#10b981',
    colorLight: '#34d399',
    paletteLabel: 'HTTP Response',
    align: 'right',
    info: `
      <h3>HTTP Response</h3>
      <p>Sends an HTTP response back to the client.</p>
      <h4>Inputs:</h4>
      <ul>
        <li><code>msg.payload</code> - Response body</li>
        <li><code>msg.statusCode</code> - HTTP status code (default: 200)</li>
        <li><code>msg.headers</code> - Additional headers</li>
      </ul>
    `,
    properties: [
      {
        name: 'statusCode',
        label: 'Status Code',
        type: 'number',
        default: 200,
        min: 100,
        max: 599,
        placeholder: 'Leave empty to use msg.statusCode'
      },
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: ''
      }
    ]
  }
});

// ===================================================================
// FUNCTION NODE
// ===================================================================

registry.register('function', {
  type: 'function',
  category: 'function',
  defaults: { 
    name: { value: '' }, 
    func: { value: 'return msg;' }, 
    outputs: { value: 1 }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    try {
      const func = new Function(
        'msg', 'node', 'context', 'flow', 'global', 'env', 'RED',
        `'use strict'; return (async () => { ${node.config.func} })();`
      );
      
      const result = await func(
        msg,
        node,
        node.context(),
        node.context().flow,
        node.context().global,
        context.env,
        RED
      );
      
      return result === undefined || result === null ? null : result;
    } catch (error: any) {
      node.error(error, msg);
      return null;
    }
  },
  
  ui: {
    icon: '⚡',
    color: '#fdd0a2',
    colorLight: '#fed7aa',
    paletteLabel: 'Function',
    info: `
      <h3>Function</h3>
      <p>Run custom JavaScript code to transform messages.</p>
      <h4>Available Variables:</h4>
      <ul>
        <li><code>msg</code> - Current message object</li>
        <li><code>node</code> - Current node instance</li>
        <li><code>flow</code> - Flow context storage</li>
        <li><code>global</code> - Global context storage</li>
        <li><code>env</code> - Environment variables</li>
      </ul>
      <h4>Examples:</h4>
      <pre>// Modify payload
msg.payload = msg.payload.toUpperCase();
return msg;

// Multiple outputs
return [msg, null, msg];

// Use context
const count = await flow.get('count') || 0;
await flow.set('count', count + 1);
msg.count = count + 1;
return msg;</pre>
    `,
    properties: [
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: '',
        placeholder: 'Optional function name'
      },
      {
        name: 'func',
        label: 'Function',
        type: 'code',
        language: 'javascript',
        rows: 12,
        default: 'return msg;',
        required: true,
        description: 'JavaScript code to execute'
      },
      {
        name: 'outputs',
        label: 'Outputs',
        type: 'number',
        default: 1,
        min: 1,
        max: 10,
        description: 'Number of outputs (return array for multiple)'
      }
    ]
  }
});

// ===================================================================
// INJECT NODE
// ===================================================================

registry.register('inject', {
  type: 'inject',
  category: 'input',
  defaults: {
    name: { value: '' },
    topic: { value: '' },
    payload: { value: '' },
    payloadType: { value: 'date' },
    repeat: { value: '' },
    crontab: { value: '' },
    once: { value: false }
  },
  inputs: 0,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node) => {
    let payload: any;
    
    switch (node.config.payloadType) {
      case 'date': payload = Date.now(); break;
      case 'str': payload = node.config.payload; break;
      case 'num': payload = Number(node.config.payload); break;
      case 'bool': payload = node.config.payload === 'true'; break;
      case 'json':
        try {
          payload = JSON.parse(node.config.payload);
        } catch {
          payload = node.config.payload;
        }
        break;
      default: payload = node.config.payload;
    }
    
    return {
      _msgid: msg._msgid || crypto.randomUUID(),
      topic: node.config.topic || msg.topic || '',
      payload
    };
  },
  
  ui: {
    icon: '💉',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Inject',
    button: {
      enabled: true,
      onclick: 'inject'
    },
    info: `
      <h3>Inject</h3>
      <p>Manually trigger a flow or schedule automatic triggers.</p>
      <h4>Options:</h4>
      <ul>
        <li><strong>Timestamp</strong> - Current timestamp in milliseconds</li>
        <li><strong>String</strong> - Static text value</li>
        <li><strong>Number</strong> - Numeric value</li>
        <li><strong>Boolean</strong> - true/false</li>
        <li><strong>JSON</strong> - JSON object</li>
      </ul>
    `,
    properties: [
      {
        name: 'payloadType',
        label: 'Payload Type',
        type: 'select',
        options: [
          { value: 'date', label: 'Timestamp' },
          { value: 'str', label: 'String' },
          { value: 'num', label: 'Number' },
          { value: 'bool', label: 'Boolean' },
          { value: 'json', label: 'JSON' }
        ],
        default: 'date'
      },
      {
        name: 'payload',
        label: 'Payload',
        type: 'text',
        default: '',
        description: 'Value to inject (leave empty for timestamp)'
      },
      {
        name: 'topic',
        label: 'Topic',
        type: 'text',
        default: '',
        placeholder: 'Optional message topic'
      },
      {
        name: 'repeat',
        label: 'Repeat (seconds)',
        type: 'number',
        default: 0,
        min: 0,
        description: 'Repeat interval in seconds (0 = manual only)'
      },
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: ''
      }
    ]
  }
});

// ===================================================================
// DEBUG NODE
// ===================================================================

registry.register('debug', {
  type: 'debug',
  category: 'output',
  defaults: { 
    name: { value: '' }, 
    active: { value: true }, 
    complete: { value: 'payload' }
  },
  inputs: 1,
  outputs: 0,
  
  execute: async (msg: NodeMessage, node: Node) => {
    if (!node.config.active) return null;
    
    const output = node.config.complete === 'true' 
      ? msg 
      : RED.util.getMessageProperty(msg, node.config.complete);
    
    console.log(`[DEBUG ${node.name || node.id}]`, output);
    
    node.status({ 
      fill: 'grey', 
      shape: 'dot', 
      text: typeof output === 'object' 
        ? JSON.stringify(output).substring(0, 32)
        : String(output).substring(0, 32)
    });
    
    return null;
  },
  
  ui: {
    icon: '🐛',
    color: '#87a980',
    colorLight: '#a8c99a',
    paletteLabel: 'Debug',
    align: 'right',
    info: `
      <h3>Debug</h3>
      <p>Output message data to the console for debugging.</p>
      <h4>Output Options:</h4>
      <ul>
        <li><strong>msg.payload</strong> - Only the payload</li>
        <li><strong>complete message</strong> - Entire message object</li>
        <li><strong>Custom property</strong> - Specific message property</li>
      </ul>
    `,
    properties: [
      {
        name: 'complete',
        label: 'Output',
        type: 'select',
        options: [
          { value: 'payload', label: 'msg.payload' },
          { value: 'true', label: 'complete msg object' }
        ],
        default: 'payload'
      },
      {
        name: 'active',
        label: 'Enabled',
        type: 'checkbox',
        default: true,
        description: 'Enable/disable debug output'
      },
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: ''
      }
    ]
  }
});

// Add more enhanced nodes here...
console.log('[RedNox] Loaded enhanced nodes with full UI metadata');
