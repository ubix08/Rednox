
// ===================================================================
// Complete Standard Node-RED Compatible Nodes with Full UI Metadata
// ===================================================================

import { registry } from '../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext } from '../types/core';
import { RED, evaluateProperty } from '../utils';

// ===================================================================
// INPUT NODES
// ===================================================================

// HTTP-IN
registry.register('http-in', {
  type: 'http-in',
  category: 'input',
  defaults: { 
    method: { value: 'post' }, 
    url: { value: '/' }, 
    name: { value: '' },
    swaggerDoc: { value: '' }
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
        default: ''
      }
    ]
  }
});

// ===================================================================
// PARSER NODES
// ===================================================================

// JSON NODE
registry.register('json', {
  type: 'json',
  category: 'parser',
  defaults: {
    name: { value: '' },
    property: { value: 'payload' },
    action: { value: '' },
    pretty: { value: false }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node) => {
    const property = node.config.property || 'payload';
    const value = RED.util.getMessageProperty(msg, property);
    
    try {
      if (node.config.action === 'obj' || 
          (node.config.action === '' && typeof value === 'string')) {
        const parsed = JSON.parse(value);
        RED.util.setMessageProperty(msg, property, parsed);
      } else if (node.config.action === 'str' || 
                 (node.config.action === '' && typeof value === 'object')) {
        const stringified = node.config.pretty 
          ? JSON.stringify(value, null, 2) 
          : JSON.stringify(value);
        RED.util.setMessageProperty(msg, property, stringified);
      }
    } catch (err: any) {
      node.error(`JSON ${node.config.action || 'parse'} error: ${err.message}`, msg);
      return null;
    }
    
    return msg;
  },
  
  ui: {
    icon: '{ }',
    color: '#fdd0a2',
    colorLight: '#fed7aa',
    paletteLabel: 'JSON',
    info: `
      <h3>JSON</h3>
      <p>Parse or stringify JSON.</p>
      <h4>Actions:</h4>
      <ul>
        <li><strong>Always convert to JSON object</strong></li>
        <li><strong>Always convert to JSON string</strong></li>
        <li><strong>Auto</strong> - Detect and convert appropriately</li>
      </ul>
    `,
    properties: [
      {
        name: 'property',
        label: 'Property',
        type: 'text',
        default: 'payload',
        description: 'Message property to convert'
      },
      {
        name: 'action',
        label: 'Action',
        type: 'select',
        options: [
          { value: '', label: 'Auto-convert' },
          { value: 'obj', label: 'Always to Object' },
          { value: 'str', label: 'Always to String' }
        ],
        default: ''
      },
      {
        name: 'pretty',
        label: 'Format JSON string',
        type: 'checkbox',
        default: false,
        description: 'Pretty-print JSON with indentation'
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

// CSV NODE
registry.register('csv', {
  type: 'csv',
  category: 'parser',
  defaults: {
    name: { value: '' },
    sep: { value: ',' },
    hdrin: { value: true },
    hdrout: { value: 'none' },
    multi: { value: 'one' },
    skip: { value: 0 },
    strings: { value: true }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node) => {
    const payload = msg.payload;
    const sep = node.config.sep || ',';
    const hdrin = node.config.hdrin !== false;
    
    try {
      if (typeof payload === 'string') {
        // CSV string to object/array
        const lines = payload.trim().split('\n');
        if (lines.length === 0) return msg;
        
        let headers: string[] = [];
        let startIdx = 0;
        
        if (hdrin && lines.length > 0) {
          headers = lines[0].split(sep).map(h => h.trim());
          startIdx = 1;
        }
        
        const result: any[] = [];
        for (let i = startIdx; i < lines.length; i++) {
          const values = lines[i].split(sep).map(v => v.trim());
          
          if (hdrin && headers.length > 0) {
            const obj: any = {};
            headers.forEach((h, idx) => {
              obj[h] = values[idx] || '';
            });
            result.push(obj);
          } else {
            result.push(values);
          }
        }
        
        msg.payload = result;
        
      } else if (Array.isArray(payload)) {
        // Array to CSV string
        const hdrout = node.config.hdrout || 'none';
        const lines: string[] = [];
        
        if (payload.length > 0 && typeof payload[0] === 'object' && !Array.isArray(payload[0])) {
          // Array of objects
          const headers = Object.keys(payload[0]);
          
          if (hdrout !== 'none') {
            lines.push(headers.join(sep));
          }
          
          payload.forEach(obj => {
            const values = headers.map(h => {
              const val = obj[h];
              const str = val === null || val === undefined ? '' : String(val);
              return str.includes(sep) || str.includes('\n') ? `"${str}"` : str;
            });
            lines.push(values.join(sep));
          });
        } else {
          // Array of arrays
          payload.forEach((row: any) => {
            if (Array.isArray(row)) {
              const values = row.map((val: any) => {
                const str = val === null || val === undefined ? '' : String(val);
                return str.includes(sep) || str.includes('\n') ? `"${str}"` : str;
              });
              lines.push(values.join(sep));
            }
          });
        }
        
        msg.payload = lines.join('\n');
      }
      
      return msg;
      
    } catch (err: any) {
      node.error(`CSV conversion error: ${err.message}`, msg);
      return null;
    }
  },
  
  ui: {
    icon: '📊',
    color: '#fdd0a2',
    colorLight: '#fed7aa',
    paletteLabel: 'CSV',
    info: `
      <h3>CSV</h3>
      <p>Convert between CSV and JavaScript objects/arrays.</p>
      <h4>Directions:</h4>
      <ul>
        <li><strong>CSV string → Array of objects</strong> (with headers)</li>
        <li><strong>CSV string → Array of arrays</strong> (without headers)</li>
        <li><strong>Array → CSV string</strong></li>
      </ul>
    `,
    properties: [
      {
        name: 'sep',
        label: 'Separator',
        type: 'text',
        default: ',',
        description: 'Column separator character'
      },
      {
        name: 'hdrin',
        label: 'Input has headers',
        type: 'checkbox',
        default: true,
        description: 'First line contains column names'
      },
      {
        name: 'hdrout',
        label: 'Output headers',
        type: 'select',
        options: [
          { value: 'none', label: 'None' },
          { value: 'all', label: 'All' }
        ],
        default: 'none',
        description: 'Include headers in CSV output'
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

// XML NODE
registry.register('xml', {
  type: 'xml',
  category: 'parser',
  defaults: {
    name: { value: '' },
    property: { value: 'payload' },
    attr: { value: '' },
    chr: { value: '' }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node) => {
    const property = node.config.property || 'payload';
    const value = RED.util.getMessageProperty(msg, property);
    
    node.warn('XML parsing not fully implemented - basic conversion only');
    
    // This is a simplified XML handler
    // For production, consider using a proper XML library
    if (typeof value === 'string') {
      // Simple XML to JSON (very basic)
      try {
        const result = { xml: value };
        RED.util.setMessageProperty(msg, property, result);
      } catch (err: any) {
        node.error(`XML parse error: ${err.message}`, msg);
        return null;
      }
    } else if (typeof value === 'object') {
      // Simple JSON to XML (very basic)
      const xml = `<root>${JSON.stringify(value)}</root>`;
      RED.util.setMessageProperty(msg, property, xml);
    }
    
    return msg;
  },
  
  ui: {
    icon: '< >',
    color: '#fdd0a2',
    colorLight: '#fed7aa',
    paletteLabel: 'XML',
    info: `
      <h3>XML</h3>
      <p>Convert between XML and JavaScript objects.</p>
      <p><strong>Note:</strong> Basic implementation. For production use, consider a proper XML library.</p>
    `,
    properties: [
      {
        name: 'property',
        label: 'Property',
        type: 'text',
        default: 'payload',
        description: 'Message property to convert'
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
// SEQUENCE NODES
// ===================================================================

// SPLIT NODE
registry.register('split', {
  type: 'split',
  category: 'sequence',
  defaults: {
    name: { value: '' },
    splt: { value: '\\n' },
    spltType: { value: 'str' },
    arraySplt: { value: 1 },
    arraySpltType: { value: 'len' },
    stream: { value: false },
    addname: { value: '' }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node) => {
    const payload = msg.payload;
    const messages: NodeMessage[] = [];
    
    if (Array.isArray(payload)) {
      // Split array
      const arraySplt = node.config.arraySplt || 1;
      const arraySpltType = node.config.arraySpltType || 'len';
      
      if (arraySpltType === 'len') {
        for (let i = 0; i < payload.length; i++) {
          const newMsg = RED.util.cloneMessage(msg);
          newMsg.payload = payload[i];
          newMsg.parts = {
            id: msg._msgid,
            index: i,
            count: payload.length,
            type: 'array'
          };
          messages.push(newMsg);
        }
      }
    } else if (typeof payload === 'string') {
      // Split string
      const splt = node.config.splt || '\\n';
      const parts = payload.split(splt === '\\n' ? '\n' : splt);
      
      for (let i = 0; i < parts.length; i++) {
        const newMsg = RED.util.cloneMessage(msg);
        newMsg.payload = parts[i];
        newMsg.parts = {
          id: msg._msgid,
          index: i,
          count: parts.length,
          type: 'string',
          ch: splt === '\\n' ? '\n' : splt
        };
        messages.push(newMsg);
      }
    } else if (typeof payload === 'object' && payload !== null) {
      // Split object
      const keys = Object.keys(payload);
      
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const newMsg = RED.util.cloneMessage(msg);
        newMsg.payload = payload[key];
        newMsg.parts = {
          id: msg._msgid,
          index: i,
          count: keys.length,
          type: 'object',
          key: key
        };
        if (node.config.addname) {
          RED.util.setMessageProperty(newMsg, node.config.addname, key);
        }
        messages.push(newMsg);
      }
    } else {
      return msg;
    }
    
    return messages;
  },
  
  ui: {
    icon: '✂️',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Split',
    info: `
      <h3>Split</h3>
      <p>Split a message into multiple messages.</p>
      <h4>Splits:</h4>
      <ul>
        <li><strong>String</strong> - By delimiter (default: newline)</li>
        <li><strong>Array</strong> - Into individual elements</li>
        <li><strong>Object</strong> - Into key/value pairs</li>
      </ul>
      <p>Adds <code>msg.parts</code> metadata for use with Join node.</p>
    `,
    properties: [
      {
        name: 'splt',
        label: 'String Delimiter',
        type: 'text',
        default: '\\n',
        placeholder: '\\n',
        description: 'Character(s) to split string on'
      },
      {
        name: 'addname',
        label: 'Add key to',
        type: 'text',
        default: '',
        placeholder: 'msg property',
        description: 'For objects, add key name to this property'
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

// JOIN NODE
registry.register('join', {
  type: 'join',
  category: 'sequence',
  defaults: {
    name: { value: '' },
    mode: { value: 'auto' },
    build: { value: 'object' },
    property: { value: 'payload' },
    propertyType: { value: 'msg' },
    key: { value: 'topic' },
    joiner: { value: '\\n' },
    joinerType: { value: 'str' },
    accumulate: { value: false },
    timeout: { value: '' },
    count: { value: '' }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const mode = node.config.mode || 'auto';
    const storageKey = `join_${node.id}`;
    
    let pending: any[] = await node.context().get(storageKey) || [];
    
    if (mode === 'auto' && msg.parts) {
      // Automatic mode based on msg.parts
      pending.push(msg);
      
      if (pending.length === msg.parts.count) {
        // Sort by index
        pending.sort((a, b) => a.parts.index - b.parts.index);
        
        let result: any;
        
        if (msg.parts.type === 'string') {
          result = pending.map(m => m.payload).join(msg.parts.ch || '');
        } else if (msg.parts.type === 'array') {
          result = pending.map(m => m.payload);
        } else if (msg.parts.type === 'object') {
          result = {};
          pending.forEach(m => {
            if (m.parts.key) {
              result[m.parts.key] = m.payload;
            }
          });
        } else {
          result = pending.map(m => m.payload);
        }
        
        await node.context().set(storageKey, []);
        
        return {
          _msgid: crypto.randomUUID(),
          payload: result,
          topic: msg.topic
        };
      } else {
        await node.context().set(storageKey, pending);
        return null;
      }
    } else if (mode === 'custom') {
      // Manual mode
      const count = parseInt(node.config.count) || 1;
      pending.push(msg);
      
      if (pending.length >= count) {
        const build = node.config.build || 'array';
        let result: any;
        
        if (build === 'string') {
          const joiner = node.config.joiner === '\\n' ? '\n' : node.config.joiner;
          result = pending.map(m => m.payload).join(joiner);
        } else if (build === 'array') {
          result = pending.map(m => m.payload);
        } else if (build === 'object') {
          result = {};
          pending.forEach(m => {
            const key = m[node.config.key] || m.topic || 'key';
            result[key] = m.payload;
          });
        }
        
        await node.context().set(storageKey, []);
        
        return {
          _msgid: crypto.randomUUID(),
          payload: result,
          topic: msg.topic
        };
      } else {
        await node.context().set(storageKey, pending);
        return null;
      }
    }
    
    return null;
  },
  
  ui: {
    icon: '🔗',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Join',
    info: `
      <h3>Join</h3>
      <p>Join multiple messages into one.</p>
      <h4>Modes:</h4>
      <ul>
        <li><strong>Automatic</strong> - Uses msg.parts from Split node</li>
        <li><strong>Manual</strong> - Join after fixed count</li>
      </ul>
      <h4>Output Types:</h4>
      <ul>
        <li><strong>String</strong> - Concatenate with delimiter</li>
        <li><strong>Array</strong> - Collect into array</li>
        <li><strong>Object</strong> - Merge into object by key</li>
      </ul>
    `,
    properties: [
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        options: [
          { value: 'auto', label: 'Automatic' },
          { value: 'custom', label: 'Manual' }
        ],
        default: 'auto'
      },
      {
        name: 'build',
        label: 'Combine to',
        type: 'select',
        options: [
          { value: 'string', label: 'String' },
          { value: 'array', label: 'Array' },
          { value: 'object', label: 'Object' }
        ],
        default: 'array'
      },
      {
        name: 'count',
        label: 'Message Count',
        type: 'number',
        default: 1,
        min: 1,
        description: 'For manual mode: join after this many messages'
      },
      {
        name: 'joiner',
        label: 'Join String',
        type: 'text',
        default: '\\n',
        placeholder: '\\n',
        description: 'For string output: character(s) to join with'
      },
      {
        name: 'key',
        label: 'Key Property',
        type: 'text',
        default: 'topic',
        description: 'For object output: property to use as key'
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

// SORT NODE
registry.register('sort', {
  type: 'sort',
  category: 'sequence',
  defaults: {
    name: { value: '' },
    order: { value: 'ascending' },
    as_num: { value: false },
    target: { value: 'payload' },
    targetType: { value: 'msg' },
    msgKey: { value: 'payload' },
    msgKeyType: { value: 'elem' },
    seqKey: { value: 'payload' },
    seqKeyType: { value: 'msg' }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node) => {
    const target = node.config.target || 'payload';
    const order = node.config.order || 'ascending';
    const asNum = node.config.as_num;
    
    let value = RED.util.getMessageProperty(msg, target);
    
    if (Array.isArray(value)) {
      const sorted = [...value].sort((a, b) => {
        let aVal = a;
        let bVal = b;
        
        if (asNum) {
          aVal = Number(aVal);
          bVal = Number(bVal);
        }
        
        if (order === 'ascending') {
          return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        } else {
          return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
        }
      });
      
      RED.util.setMessageProperty(msg, target, sorted);
    }
    
    return msg;
  },
  
  ui: {
    icon: '⬍',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Sort',
    info: `
      <h3>Sort</h3>
      <p>Sort an array or sequence of messages.</p>
      <h4>Options:</h4>
      <ul>
        <li><strong>Ascending/Descending</strong></li>
        <li><strong>As string or number</strong></li>
      </ul>
    `,
    properties: [
      {
        name: 'target',
        label: 'Target',
        type: 'text',
        default: 'payload',
        description: 'Property containing array to sort'
      },
      {
        name: 'order',
        label: 'Order',
        type: 'select',
        options: [
          { value: 'ascending', label: 'Ascending' },
          { value: 'descending', label: 'Descending' }
        ],
        default: 'ascending'
      },
      {
        name: 'as_num',
        label: 'Sort as number',
        type: 'checkbox',
        default: false,
        description: 'Compare values numerically'
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

// BATCH NODE
registry.register('batch', {
  type: 'batch',
  category: 'sequence',
  defaults: {
    name: { value: '' },
    mode: { value: 'count' },
    count: { value: 10 },
    overlap: { value: 0 },
    interval: { value: 10 },
    allowEmptySequence: { value: false },
    topics: { value: [] }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node) => {
    const mode = node.config.mode || 'count';
    const count = parseInt(node.config.count) || 10;
    const storageKey = `batch_${node.id}`;
    
    let pending: NodeMessage[] = await node.context().get(storageKey) || [];
    pending.push(msg);
    
    if (mode === 'count' && pending.length >= count) {
      const batch = pending.slice(0, count);
      const remaining = pending.slice(count);
      
      await node.context().set(storageKey, remaining);
      
      return {
        _msgid: crypto.randomUUID(),
        payload: batch.map(m => m.payload),
        topic: msg.topic,
        parts: {
          id: crypto.randomUUID(),
          index: 0,
          count: 1,
          type: 'array'
        }
      };
    } else {
      await node.context().set(storageKey, pending);
      return null;
    }
  },
  
  ui: {
    icon: '📦',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Batch',
    info: `
      <h3>Batch</h3>
      <p>Group messages into batches.</p>
      <h4>Modes:</h4>
      <ul>
        <li><strong>By count</strong> - Fixed number of messages</li>
        <li><strong>By interval</strong> - Time-based batches</li>
      </ul>
    `,
    properties: [
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        options: [
          { value: 'count', label: 'By message count' },
          { value: 'interval', label: 'By time interval' }
        ],
        default: 'count'
      },
      {
        name: 'count',
        label: 'Count',
        type: 'number',
        default: 10,
        min: 1,
        description: 'Number of messages per batch'
      },
      {
        name: 'overlap',
        label: 'Overlap',
        type: 'number',
        default: 0,
        min: 0,
        description: 'Number of messages to overlap between batches'
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
// STORAGE NODES
// ===================================================================

// CONTEXT NODE
registry.register('context', {
  type: 'context',
  category: 'storage',
  defaults: {
    name: { value: '' },
    action: { value: 'get' },
    property: { value: '' },
    storage: { value: 'flow' },
    value: { value: '' },
    valueType: { value: 'str' }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const action = node.config.action || 'get';
    const property = node.config.property || '';
    const storage = node.config.storage || 'flow';
    
    const storageContext = storage === 'flow' 
      ? node.context().flow 
      : node.context().global;
    
    try {
      if (action === 'get') {
        const value = await storageContext.get(property);
        msg.payload = value;
      } else if (action === 'set') {
        const value = await evaluateProperty(
          { v: node.config.value, vt: node.config.valueType },
          msg,
          node,
          context
        );
        await storageContext.set(property, value);
      } else if (action === 'delete') {
        await storageContext.set(property, undefined);
      } else if (action === 'keys') {
        const keys = await storageContext.keys();
        msg.payload = keys;
      }
    } catch (err: any) {
      node.error(`Context ${action} error: ${err.message}`, msg);
    }
    
    return msg;
  },
  
  ui: {
    icon: '💾',
    color: '#e2d96e',
    colorLight: '#ebe8a3',
    paletteLabel: 'Context',
    info: `
      <h3>Context</h3>
      <p>Read or write to flow or global context storage.</p>
      <h4>Actions:</h4>
      <ul>
        <li><strong>Get</strong> - Retrieve value to msg.payload</li>
        <li><strong>Set</strong> - Store value</li>
        <li><strong>Delete</strong> - Remove value</li>
        <li><strong>Keys</strong> - List all keys</li>
      </ul>
      <h4>Storage Scopes:</h4>
      <ul>
        <li><strong>Flow</strong> - Shared within this flow</li>
        <li><strong>Global</strong> - Shared across all flows</li>
      </ul>
    `,
    properties: [
      {
        name: 'action',
        label: 'Action',
        type: 'select',
        options: [
          { value: 'get', label: 'Get value' },
          { value: 'set', label: 'Set value' },
          { value: 'delete', label: 'Delete' },
          { value: 'keys', label: 'List keys' }
        ],
        default: 'get'
      },
      {
        name: 'property',
        label: 'Key',
        type: 'text',
        default: '',
        required: true,
        placeholder: 'storage-key',
        description: 'Context key name'
      },
      {
        name: 'storage',
        label: 'Storage',
        type: 'select',
        options: [
          { value: 'flow', label: 'Flow context' },
          { value: 'global', label: 'Global context' }
        ],
        default: 'flow'
      },
      {
        name: 'value',
        label: 'Value',
        type: 'text',
        default: '',
        description: 'Value to set (for set action)'
      },
      {
        name: 'valueType',
        label: 'Value Type',
        type: 'select',
        options: [
          { value: 'msg', label: 'msg.' },
          { value: 'str', label: 'string' },
          { value: 'num', label: 'number' },
          { value: 'bool', label: 'boolean' },
          { value: 'json', label: 'JSON' }
        ],
        default: 'str'
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

// INJECT NODE
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
      case 'date': 
        payload = Date.now(); 
        break;
      case 'str': 
        payload = node.config.payload; 
        break;
      case 'num': 
        payload = Number(node.config.payload); 
        break;
      case 'bool': 
        payload = node.config.payload === 'true'; 
        break;
      case 'json':
        try {
          payload = JSON.parse(node.config.payload);
        } catch {
          payload = node.config.payload;
        }
        break;
      default: 
        payload = node.config.payload;
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
        name: 'once',
        label: 'Inject once at start',
        type: 'checkbox',
        default: false
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
// OUTPUT NODES
// ===================================================================

// HTTP RESPONSE
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

// DEBUG NODE
registry.register('debug', {
  type: 'debug',
  category: 'output',
  defaults: { 
    name: { value: '' }, 
    active: { value: true }, 
    complete: { value: 'payload' },
    console: { value: false },
    tosidebar: { value: true }
  },
  inputs: 1,
  outputs: 0,
  
  execute: async (msg: NodeMessage, node: Node) => {
    if (!node.config.active) return null;
    
    const output = node.config.complete === 'true' 
      ? msg 
      : RED.util.getMessageProperty(msg, node.config.complete);
    
    if (node.config.console) {
      console.log(`[DEBUG ${node.name || node.id}]`, output);
    }
    
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
        name: 'console',
        label: 'Output to console',
        type: 'checkbox',
        default: false,
        description: 'Write to server console'
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
// FUNCTION NODES
// ===================================================================

// FUNCTION NODE
registry.register('function', {
  type: 'function',
  category: 'function',
  defaults: { 
    name: { value: '' }, 
    func: { value: 'return msg;' }, 
    outputs: { value: 1 },
    noerr: { value: 0 },
    initialize: { value: '' },
    finalize: { value: '' }
  },
  inputs: 1,
  outputs: 1,
  
  onInit: async (node: Node, context: ExecutionContext) => {
    if (node.config.initialize) {
      try {
        const initFunc = new Function(
          'node', 'context', 'flow', 'global', 'env', 'RED',
          `'use strict'; return (async () => { ${node.config.initialize} })();`
        );
        
        await initFunc(
          node,
          node.context(),
          node.context().flow,
          node.context().global,
          context.env,
          RED
        );
      } catch (err: any) {
        node.error('Initialize error: ' + err.message);
      }
    }
  },
  
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
      if (node.config.noerr !== 1) {
        node.error(error, msg);
      }
      return null;
    }
  },
  
  onClose: async (node: Node, context: ExecutionContext) => {
    if (node.config.finalize) {
      try {
        const finalFunc = new Function(
          'node', 'context', 'flow', 'global', 'env', 'RED',
          `'use strict'; return (async () => { ${node.config.finalize} })();`
        );
        
        await finalFunc(
          node,
          node.context(),
          node.context().flow,
          node.context().global,
          context.env,
          RED
        );
      } catch (err: any) {
        node.error('Finalize error: ' + err.message);
      }
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
      },
      {
        name: 'initialize',
        label: 'Setup Code',
        type: 'code',
        language: 'javascript',
        rows: 4,
        default: '',
        description: 'Code to run when flow starts'
      },
      {
        name: 'finalize',
        label: 'Close Code',
        type: 'code',
        language: 'javascript',
        rows: 4,
        default: '',
        description: 'Code to run when flow stops'
      },
      {
        name: 'noerr',
        label: 'Catch errors',
        type: 'select',
        options: [
          { value: 0, label: 'Send to catch nodes' },
          { value: 1, label: 'Handle within function' }
        ],
        default: 0
      }
    ]
  }
});

// CHANGE NODE
registry.register('change', {
  type: 'change',
  category: 'function',
  defaults: {
    name: { value: '' },
    rules: { value: [{ t: 'set', p: 'payload', pt: 'msg', to: '', tot: 'str' }] }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const rules = node.config.rules || [];
    
    for (const rule of rules) {
      try {
        const property = rule.p;
        const propertyType = rule.pt || 'msg';
        
        switch (rule.t) {
          case 'set':
            const value = await evaluateProperty(
              { v: rule.to, vt: rule.tot },
              msg,
              node,
              context
            );
            if (propertyType === 'msg') {
              RED.util.setMessageProperty(msg, property, value);
            } else if (propertyType === 'flow') {
              await node.context().flow.set(property, value);
            } else if (propertyType === 'global') {
              await node.context().global.set(property, value);
            }
            break;
            
          case 'delete':
            if (propertyType === 'msg') {
              const parts = property.split('.');
              let obj: any = msg;
              for (let i = 0; i < parts.length - 1; i++) {
                obj = obj[parts[i]];
                if (!obj) break;
              }
              if (obj) delete obj[parts[parts.length - 1]];
            } else if (propertyType === 'flow') {
              await node.context().flow.set(property, undefined);
            } else if (propertyType === 'global') {
              await node.context().global.set(property, undefined);
            }
            break;
            
          case 'move':
            const moveValue = RED.util.getMessageProperty(msg, property);
            RED.util.setMessageProperty(msg, rule.to, moveValue);
            const parts = property.split('.');
            let obj: any = msg;
            for (let i = 0; i < parts.length - 1; i++) {
              obj = obj[parts[i]];
              if (!obj) break;
            }
            if (obj) delete obj[parts[parts.length - 1]];
            break;
            
          case 'change':
            let changeValue = RED.util.getMessageProperty(msg, property);
            if (typeof changeValue === 'string') {
              if (rule.fromt === 're') {
                const regex = new RegExp(rule.from, rule.reg ? 'g' : '');
                changeValue = changeValue.replace(regex, rule.to);
              } else {
                changeValue = changeValue.split(rule.from).join(rule.to);
              }
              RED.util.setMessageProperty(msg, property, changeValue);
            }
            break;
        }
      } catch (err: any) {
        node.error(`Rule error: ${err.message}`, msg);
      }
    }
    
    return msg;
  },
  
  ui: {
    icon: '🔧',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Change',
    info: `
      <h3>Change</h3>
      <p>Set, change, move or delete message properties.</p>
      <h4>Operations:</h4>
      <ul>
        <li><strong>Set</strong> - Set a property value</li>
        <li><strong>Change</strong> - Search and replace in a string</li>
        <li><strong>Move</strong> - Move a property</li>
        <li><strong>Delete</strong> - Delete a property</li>
      </ul>
    `,
    properties: [
      {
        name: 'rules',
        label: 'Rules',
        type: 'json',
        default: [{ t: 'set', p: 'payload', pt: 'msg', to: '', tot: 'str' }],
        description: 'Array of transformation rules'
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

// SWITCH NODE
registry.register('switch', {
  type: 'switch',
  category: 'function',
  defaults: {
    name: { value: '' },
    property: { value: 'payload' },
    propertyType: { value: 'msg' },
    rules: { value: [{ t: 'eq', v: '', vt: 'str' }] },
    checkall: { value: true },
    repair: { value: false }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const property = node.config.property || 'payload';
    const propertyType = node.config.propertyType || 'msg';
    const rules = node.config.rules || [];
    const checkAll = node.config.checkall !== false;
    
    let value: any;
    if (propertyType === 'msg') {
      value = RED.util.getMessageProperty(msg, property);
    } else if (propertyType === 'flow') {
      value = await node.context().flow.get(property);
    } else if (propertyType === 'global') {
      value = await node.context().global.get(property);
    }
    
    const outputs: (NodeMessage | null)[] = rules.map(() => null);
    let matchFound = false;
    
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      let testValue = await evaluateProperty(
        { v: rule.v, vt: rule.vt || 'str' },
        msg,
        node,
        context
      );
      
      let match = false;
      
      switch (rule.t) {
        case 'eq':
          match = value == testValue;
          break;
        case 'neq':
          match = value != testValue;
          break;
        case 'lt':
          match = value < testValue;
          break;
        case 'lte':
          match = value <= testValue;
          break;
        case 'gt':
          match = value > testValue;
          break;
        case 'gte':
          match = value >= testValue;
          break;
        case 'btwn':
          match = value >= rule.v && value <= rule.v2;
          break;
        case 'cont':
          match = String(value).includes(String(testValue));
          break;
        case 'regex':
          const regex = new RegExp(rule.v, rule.case ? '' : 'i');
          match = regex.test(String(value));
          break;
        case 'true':
          match = value === true;
          break;
        case 'false':
          match = value === false;
          break;
        case 'null':
          match = value == null;
          break;
        case 'nnull':
          match = value != null;
          break;
        case 'empty':
          match = value === '' || value === null || value === undefined ||
                  (Array.isArray(value) && value.length === 0) ||
                  (typeof value === 'object' && Object.keys(value).length === 0);
          break;
        case 'nempty':
          match = !(value === '' || value === null || value === undefined ||
                   (Array.isArray(value) && value.length === 0) ||
                   (typeof value === 'object' && Object.keys(value).length === 0));
          break;
        case 'istype':
          match = typeof value === rule.v;
          break;
        case 'else':
          match = !matchFound;
          break;
      }
      
      if (match) {
        outputs[i] = RED.util.cloneMessage(msg);
        matchFound = true;
        if (!checkAll) break;
      }
    }
    
    return outputs;
  },
  
  ui: {
    icon: '⚖️',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Switch',
    info: `
      <h3>Switch</h3>
      <p>Route messages based on property values.</p>
      <h4>Comparison Types:</h4>
      <ul>
        <li><strong>==</strong> - Equal to</li>
        <li><strong>!=</strong> - Not equal to</li>
        <li><strong>&lt;</strong> - Less than</li>
        <li><strong>&gt;</strong> - Greater than</li>
        <li><strong>contains</strong> - String contains</li>
        <li><strong>matches regex</strong> - Regular expression match</li>
        <li><strong>is true/false</strong> - Boolean check</li>
        <li><strong>is null/not null</strong> - Null check</li>
        <li><strong>is empty/not empty</strong> - Empty check</li>
      </ul>
    `,
    properties: [
      {
        name: 'property',
        label: 'Property',
        type: 'text',
        default: 'payload',
        description: 'Message property to test'
      },
      {
        name: 'propertyType',
        label: 'Property Type',
        type: 'select',
        options: [
          { value: 'msg', label: 'msg.' },
          { value: 'flow', label: 'flow.' },
          { value: 'global', label: 'global.' }
        ],
        default: 'msg'
      },
      {
        name: 'rules',
        label: 'Rules',
        type: 'json',
        default: [{ t: 'eq', v: '', vt: 'str' }],
        description: 'Array of routing rules'
      },
      {
        name: 'checkall',
        label: 'Check all rules',
        type: 'checkbox',
        default: true,
        description: 'Continue checking after first match'
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

// TEMPLATE NODE
registry.register('template', {
  type: 'template',
  category: 'function',
  defaults: {
    name: { value: '' },
    field: { value: 'payload' },
    fieldType: { value: 'msg' },
    format: { value: 'handlebars' },
    syntax: { value: 'mustache' },
    template: { value: 'This is the payload: {{payload}} !' },
    output: { value: 'str' }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node) => {
    const template = node.config.template || '';
    const field = node.config.field || 'payload';
    const fieldType = node.config.fieldType || 'msg';
    const output = node.config.output || 'str';
    
    // Simple Mustache-style templating
    let result = template;
    
    // Replace {{propertyPath}} with values from msg
    result = result.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const value = RED.util.getMessageProperty(msg, path.trim());
      return value !== undefined ? String(value) : match;
    });
    
    // Set result to target field
    if (fieldType === 'msg') {
      if (output === 'json') {
        try {
          result = JSON.parse(result);
        } catch (err) {
          node.error('Template output is not valid JSON', msg);
          return null;
        }
      }
      RED.util.setMessageProperty(msg, field, result);
    }
    
    return msg;
  },
  
  ui: {
    icon: '📝',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Template',
    info: `
      <h3>Template</h3>
      <p>Generate text using a template with message properties.</p>
      <h4>Syntax:</h4>
      <p>Use <code>{{propertyPath}}</code> to insert message values.</p>
      <h4>Example:</h4>
      <pre>Hello {{payload.name}}, your order {{payload.orderId}} is ready!</pre>
    `,
    properties: [
      {
        name: 'template',
        label: 'Template',
        type: 'textarea',
        rows: 8,
        default: 'This is the payload: {{payload}} !',
        description: 'Template text with {{property}} placeholders'
      },
      {
        name: 'field',
        label: 'Set property',
        type: 'text',
        default: 'payload',
        description: 'Property to set with template result'
      },
      {
        name: 'fieldType',
        label: 'Property Type',
        type: 'select',
        options: [
          { value: 'msg', label: 'msg.' }
        ],
        default: 'msg'
      },
      {
        name: 'output',
        label: 'Output as',
        type: 'select',
        options: [
          { value: 'str', label: 'Plain text' },
          { value: 'json', label: 'Parsed JSON' }
        ],
        default: 'str'
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

// RANGE NODE
registry.register('range', {
  type: 'range',
  category: 'function',
  defaults: {
    name: { value: '' },
    action: { value: 'scale' },
    round: { value: false },
    minin: { value: '0' },
    maxin: { value: '10' },
    minout: { value: '0' },
    maxout: { value: '100' },
    property: { value: 'payload' }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node) => {
    const property = node.config.property || 'payload';
    const value = RED.util.getMessageProperty(msg, property);
    
    if (typeof value !== 'number') {
      node.warn('Input value is not a number');
      return msg;
    }
    
    const action = node.config.action || 'scale';
    const minin = parseFloat(node.config.minin) || 0;
    const maxin = parseFloat(node.config.maxin) || 10;
    const minout = parseFloat(node.config.minout) || 0;
    const maxout = parseFloat(node.config.maxout) || 100;
    
    let result: number;
    
    if (action === 'scale') {
      // Scale value from input range to output range
      result = ((value - minin) / (maxin - minin)) * (maxout - minout) + minout;
    } else if (action === 'clamp') {
      // Clamp value to range
      result = Math.max(minout, Math.min(maxout, value));
    } else {
      // Scale and clamp
      result = ((value - minin) / (maxin - minin)) * (maxout - minout) + minout;
      result = Math.max(minout, Math.min(maxout, result));
    }
    
    if (node.config.round) {
      result = Math.round(result);
    }
    
    RED.util.setMessageProperty(msg, property, result);
    return msg;
  },
  
  ui: {
    icon: '📐',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Range',
    info: `
      <h3>Range</h3>
      <p>Scale numeric values between ranges or clamp to limits.</p>
      <h4>Actions:</h4>
      <ul>
        <li><strong>Scale</strong> - Map from input range to output range</li>
        <li><strong>Clamp</strong> - Limit to min/max bounds</li>
        <li><strong>Scale & Clamp</strong> - Both operations</li>
      </ul>
    `,
    properties: [
      {
        name: 'action',
        label: 'Action',
        type: 'select',
        options: [
          { value: 'scale', label: 'Scale' },
          { value: 'clamp', label: 'Clamp' },
          { value: 'both', label: 'Scale and clamp' }
        ],
        default: 'scale'
      },
      {
        name: 'property',
        label: 'Property',
        type: 'text',
        default: 'payload',
        description: 'Message property to scale'
      },
      {
        name: 'minin',
        label: 'Input min',
        type: 'number',
        default: 0
      },
      {
        name: 'maxin',
        label: 'Input max',
        type: 'number',
        default: 10
      },
      {
        name: 'minout',
        label: 'Output min',
        type: 'number',
        default: 0
      },
      {
        name: 'maxout',
        label: 'Output max',
        type: 'number',
        default: 100
      },
      {
        name: 'round',
        label: 'Round result',
        type: 'checkbox',
        default: false,
        description: 'Round to nearest integer'
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

// DELAY NODE
registry.register('delay', {
  type: 'delay',
  category: 'function',
  defaults: {
    name: { value: '' },
    pauseType: { value: 'delay' },
    timeout: { value: '5' },
    timeoutUnits: { value: 'seconds' },
    rate: { value: '1' },
    nbRateUnits: { value: '1' },
    rateUnits: { value: 'second' },
    randomFirst: { value: '1' },
    randomLast: { value: '5' },
    randomUnits: { value: 'seconds' },
    drop: { value: false }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node) => {
    const pauseType = node.config.pauseType || 'delay';
    
    if (pauseType === 'delay') {
      const timeout = parseFloat(node.config.timeout) || 5;
      const units = node.config.timeoutUnits || 'seconds';
      const multipliers: Record<string, number> = {
        milliseconds: 1,
        seconds: 1000,
        minutes: 60000,
        hours: 3600000
      };
      const delay = timeout * (multipliers[units] || 1000);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return msg;
    } else if (pauseType === 'random') {
      const first = parseFloat(node.config.randomFirst) || 1;
      const last = parseFloat(node.config.randomLast) || 5;
      const units = node.config.randomUnits || 'seconds';
      const multipliers: Record<string, number> = {
        milliseconds: 1,
        seconds: 1000,
        minutes: 60000,
        hours: 3600000
      };
      
      const randomDelay = (first + Math.random() * (last - first)) * (multipliers[units] || 1000);
      await new Promise(resolve => setTimeout(resolve, randomDelay));
      return msg;
    } else if (pauseType === 'rate') {
      // Rate limiting - simplified implementation
      node.warn('Rate limiting not fully implemented');
      return msg;
    }
    
    return msg;
  },
  
  ui: {
    icon: '⏱️',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Delay',
    info: `
      <h3>Delay</h3>
      <p>Delay messages or rate limit message flow.</p>
      <h4>Modes:</h4>
      <ul>
        <li><strong>Fixed Delay</strong> - Wait specified time</li>
        <li><strong>Random Delay</strong> - Random time within range</li>
        <li><strong>Rate Limit</strong> - Limit messages per time period</li>
      </ul>
    `,
    properties: [
      {
        name: 'pauseType',
        label: 'Action',
        type: 'select',
        options: [
          { value: 'delay', label: 'Delay message' },
          { value: 'random', label: 'Random delay' },
          { value: 'rate', label: 'Rate limit' }
        ],
        default: 'delay'
      },
      {
        name: 'timeout',
        label: 'Delay',
        type: 'number',
        default: 5,
        min: 0
      },
      {
        name: 'timeoutUnits',
        label: 'Units',
        type: 'select',
        options: [
          { value: 'milliseconds', label: 'Milliseconds' },
          { value: 'seconds', label: 'Seconds' },
          { value: 'minutes', label: 'Minutes' },
          { value: 'hours', label: 'Hours' }
        ],
        default: 'seconds'
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

// TRIGGER NODE
registry.register('trigger', {
  type: 'trigger',
  category: 'function',
  defaults: {
    name: { value: '' },
    op1: { value: '1' },
    op2: { value: '0' },
    op1type: { value: 'str' },
    op2type: { value: 'str' },
    duration: { value: '250' },
    extend: { value: false },
    units: { value: 'ms' },
    reset: { value: '' },
    bytopic: { value: 'all' }
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node) => {
    const output1 = node.config.op1;
    const duration = parseFloat(node.config.duration) || 250;
    const units = node.config.units || 'ms';
    
    const multipliers: Record<string, number> = {
      ms: 1,
      s: 1000,
      min: 60000,
      hr: 3600000
    };
    
    const delayMs = duration * (multipliers[units] || 1);
    
    // Send first output immediately
    const msg1 = RED.util.cloneMessage(msg);
    msg1.payload = output1;
    
    // Send second output after delay
    setTimeout(async () => {
      const msg2 = RED.util.cloneMessage(msg);
      msg2.payload = node.config.op2;
      await node.send(msg2);
    }, delayMs);
    
    return msg1;
  },
  
  ui: {
    icon: '⚡',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Trigger',
    info: `
      <h3>Trigger</h3>
      <p>Send a message, then send a second message after a delay.</p>
      <p>Useful for creating pulses or timed sequences.</p>
    `,
    properties: [
      {
        name: 'op1',
        label: 'Send first',
        type: 'text',
        default: '1'
      },
      {
        name: 'op2',
        label: 'Then send',
        type: 'text',
        default: '0'
      },
      {
        name: 'duration',
        label: 'After',
        type: 'number',
        default: 250,
        min: 0
      },
      {
        name: 'units',
        label: 'Units',
        type: 'select',
        options: [
          { value: 'ms', label: 'Milliseconds' },
          { value: 's', label: 'Seconds' },
          { value: 'min', label: 'Minutes' },
          { value: 'hr', label: 'Hours' }
        ],
        default: 'ms'
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

// EXEC NODE
registry.register('exec', {
  type: 'exec',
  category: 'function',
  defaults: {
    name: { value: '' },
    command: { value: '' },
    addpay: { value: true },
    append: { value: '' },
    useSpawn: { value: false },
    timer: { value: '' }
  },
  inputs: 1,
  outputs: 3,
  
  execute: async (msg: NodeMessage, node: Node) => {
    node.error('Exec node not available in browser environment', msg);
    return null;
  },
  
  ui: {
    icon: '💻',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Exec',
    info: `
      <h3>Exec</h3>
      <p><strong>Note:</strong> Not available in browser environment.</p>
      <p>In Node-RED, this executes system commands.</p>
    `,
    properties: [
      {
        name: 'command',
        label: 'Command',
        type: 'text',
        default: '',
        description: 'Command to execute'
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

// COMMENT NODE
registry.register('comment', {
  type: 'comment',
  category: 'function',
  defaults: {
    name: { value: '' },
    info: { value: '' }
  },
  inputs: 0,
  outputs: 0,
  
  execute: async (msg: NodeMessage) => null,
  
  ui: {
    icon: '💬',
    color: '#ffffcc',
    colorLight: '#ffffee',
    paletteLabel: 'Comment',
    info: `
      <h3>Comment</h3>
      <p>Add notes and documentation to your flows.</p>
      <p>This node has no inputs or outputs - it's purely for documentation.</p>
    `,
    properties: [
      {
        name: 'name',
        label: 'Title',
        type: 'text',
        default: '',
        placeholder: 'Comment title'
      },
      {
        name: 'info',
        label: 'Notes',
        type: 'textarea',
        rows: 6,
        default: '',
        placeholder: 'Add your notes here...',
        description: 'Additional documentation'
      }
    ]
  }
});

// LINK IN/OUT NODES
registry.register('link-in', {
  type: 'link-in',
  category: 'function',
  defaults: {
    name: { value: '' },
    links: { value: [] }
  },
  inputs: 0,
  outputs: 1,
  
  execute: async (msg: NodeMessage) => msg,
  
  ui: {
    icon: '📥',
    color: '#dddddd',
    colorLight: '#eeeeee',
    paletteLabel: 'Link In',
    info: `
      <h3>Link In</h3>
      <p>Receive messages from Link Out nodes.</p>
      <p>Creates virtual wires between distant parts of your flow.</p>
    `,
    properties: [
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: '',
        required: true,
        description: 'Unique name to identify this link endpoint'
      }
    ]
  }
});

registry.register('link-out', {
  type: 'link-out',
  category: 'function',
  defaults: {
    name: { value: '' },
    links: { value: [] },
    mode: { value: 'link' }
  },
  inputs: 1,
  outputs: 0,
  
  execute: async (msg: NodeMessage, node: Node) => {
    // Link nodes would need special handling in the execution engine
    node.warn('Link routing not fully implemented');
    return null;
  },
  
  ui: {
    icon: '📤',
    color: '#dddddd',
    colorLight: '#eeeeee',
    paletteLabel: 'Link Out',
    align: 'right',
    info: `
      <h3>Link Out</h3>
      <p>Send messages to Link In nodes.</p>
      <p>Creates virtual wires between distant parts of your flow.</p>
    `,
    properties: [
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        options: [
          { value: 'link', label: 'Send to link nodes' },
          { value: 'return', label: 'Return to calling link' }
        ],
        default: 'link'
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

// CATCH NODE
registry.register('catch', {
  type: 'catch',
  category: 'function',
  defaults: {
    name: { value: '' },
    scope: { value: [] },
    uncaught: { value: false }
  },
  inputs: 0,
  outputs: 1,
  
  execute: async (msg: NodeMessage) => msg,
  
  ui: {
    icon: '🎣',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Catch',
    info: `
      <h3>Catch</h3>
      <p>Catch errors thrown by nodes.</p>
      <p>Use to handle errors gracefully in your flows.</p>
    `,
    properties: [
      {
        name: 'uncaught',
        label: 'Catch all uncaught errors',
        type: 'checkbox',
        default: false,
        description: 'Catch errors from all nodes'
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

// STATUS NODE
registry.register('status', {
  type: 'status',
  category: 'function',
  defaults: {
    name: { value: '' },
    scope: { value: [] }
  },
  inputs: 0,
  outputs: 1,
  
  execute: async (msg: NodeMessage) => msg,
  
  ui: {
    icon: '📊',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Status',
    info: `
      <h3>Status</h3>
      <p>Report the status of nodes.</p>
      <p>Outputs a message when a node updates its status.</p>
    `,
    properties: [
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: ''
      }
    ]
  }
});

// COMPLETE NODE
registry.register('complete', {
  type: 'complete',
  category: 'function',
  defaults: {
    name: { value: '' },
    scope: { value: [] }
  },
  inputs: 0,
  outputs: 1,
  
  execute: async (msg: NodeMessage) => msg,
  
  ui: {
    icon: '✅',
    color: '#e7e7ae',
    colorLight: '#f5f5d8',
    paletteLabel: 'Complete',
    info: `
      <h3>Complete</h3>
      <p>Triggered when a message completes processing through specified nodes.</p>
    `,
    properties: [
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: ''
      }
    ]
  }
});
