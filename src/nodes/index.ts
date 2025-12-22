
// ===================================================================
// RedNox - Extended Node Implementations
// ===================================================================

import { registry } from '../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext } from '../types/core';
import { RED, evaluateProperty } from '../utils';

// ===================================================================
// CORE INPUT/OUTPUT NODES
// ===================================================================

// HTTP Input Node (already exists)
registry.register('http-in', {
  type: 'http-in',
  category: 'input',
  color: '#e7e7ae',
  defaults: { method: { value: 'get' }, url: { value: '/' }, name: { value: '' } },
  inputs: 0,
  outputs: 1,
  icon: 'white-globe.svg',
  execute: async (msg: NodeMessage) => msg
});

// HTTP Response Node (already exists)
registry.register('http-response', {
  type: 'http-response',
  category: 'output',
  color: '#e7e7ae',
  defaults: { name: { value: '' }, statusCode: { value: '' }, headers: { value: {} } },
  inputs: 1,
  outputs: 0,
  execute: async (msg: NodeMessage, node: Node) => {
    const headers = { 'Content-Type': 'application/json', ...msg.headers };
    
    // Allow node to override headers
    if (node.config.headers) {
      Object.assign(headers, node.config.headers);
    }
    
    msg._httpResponse = {
      statusCode: node.config.statusCode || msg.statusCode || 200,
      headers,
      payload: msg.payload
    };
    return null;
  }
});

// ===================================================================
// FUNCTION NODES
// ===================================================================

// Function Node (already exists, enhanced)
registry.register('function', {
  type: 'function',
  category: 'function',
  color: '#fdd0a2',
  defaults: { 
    name: { value: '' }, 
    func: { value: 'return msg;' }, 
    outputs: { value: 1 },
    timeout: { value: 0 }
  },
  inputs: 1,
  outputs: 1,
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    try {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const func = new AsyncFunction(
        'msg',
        'node',
        'context',
        'flow',
        'global',
        'env',
        node.config.func
      );
      
      const result = await func(
        msg,
        node,
        node.context(),
        node.context().flow,
        node.context().global,
        context.env
      );
      
      return result === undefined || result === null ? null : result;
    } catch (error: any) {
      node.error(error, msg);
      return null;
    }
  }
});

// Switch Node - Route messages based on conditions
registry.register('switch', {
  type: 'switch',
  category: 'function',
  color: '#fdd0a2',
  defaults: { 
    name: { value: '' }, 
    property: { value: 'payload' },
    rules: { value: [{ t: 'eq', v: '', vt: 'str' }] },
    checkall: { value: true },
    repair: { value: false }
  },
  inputs: 1,
  outputs: 1,
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const property = RED.util.getMessageProperty(msg, node.config.property);
    const results: (NodeMessage | null)[] = [];
    
    for (const rule of node.config.rules || []) {
      let match = false;
      const ruleValue = await evaluateProperty(rule, msg, node, context);
      
      switch (rule.t) {
        case 'eq':
          match = property == ruleValue;
          break;
        case 'neq':
          match = property != ruleValue;
          break;
        case 'lt':
          match = Number(property) < Number(ruleValue);
          break;
        case 'lte':
          match = Number(property) <= Number(ruleValue);
          break;
        case 'gt':
          match = Number(property) > Number(ruleValue);
          break;
        case 'gte':
          match = Number(property) >= Number(ruleValue);
          break;
        case 'btwn':
          const val = Number(property);
          match = val >= Number(rule.v) && val <= Number(rule.v2);
          break;
        case 'cont':
          match = String(property).includes(String(ruleValue));
          break;
        case 'regex':
          match = new RegExp(String(ruleValue)).test(String(property));
          break;
        case 'true':
          match = !!property;
          break;
        case 'false':
          match = !property;
          break;
        case 'null':
          match = property === null;
          break;
        case 'nnull':
          match = property !== null;
          break;
        case 'empty':
          match = property === '' || property === null || property === undefined ||
                  (Array.isArray(property) && property.length === 0);
          break;
        case 'nempty':
          match = property !== '' && property !== null && property !== undefined &&
                  !(Array.isArray(property) && property.length === 0);
          break;
        case 'istype':
          match = typeof property === ruleValue;
          break;
      }
      
      results.push(match ? RED.util.cloneMessage(msg) : null);
      
      if (match && !node.config.checkall) break;
    }
    
    return results;
  }
});

// Change Node (already exists)
registry.register('change', {
  type: 'change',
  category: 'function',
  color: '#fdd0a2',
  defaults: { name: { value: '' }, rules: { value: [] } },
  inputs: 1,
  outputs: 1,
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    for (const rule of node.config.rules || []) {
      try {
        if (rule.t === 'set') {
          const setValue = await evaluateProperty(rule, msg, node, context);
          RED.util.setMessageProperty(msg, rule.p, setValue);
        } else if (rule.t === 'delete') {
          const parts = rule.p.split('.');
          let obj = msg;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!(parts[i] in obj)) return msg;
            obj = obj[parts[i]];
          }
          delete obj[parts[parts.length - 1]];
        } else if (rule.t === 'move') {
          const value = RED.util.getMessageProperty(msg, rule.p);
          RED.util.setMessageProperty(msg, rule.to, value);
          const parts = rule.p.split('.');
          let obj = msg;
          for (let i = 0; i < parts.length - 1; i++) {
            obj = obj[parts[i]];
          }
          delete obj[parts[parts.length - 1]];
        }
      } catch (err) {
        node.error('Rule execution failed: ' + err, msg);
      }
    }
    return msg;
  }
});

// Range Node - Scale values
registry.register('range', {
  type: 'range',
  category: 'function',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    minin: { value: 0 },
    maxin: { value: 100 },
    minout: { value: 0 },
    maxout: { value: 1 },
    property: { value: 'payload' },
    round: { value: false }
  },
  inputs: 1,
  outputs: 1,
  execute: async (msg: NodeMessage, node: Node) => {
    const value = RED.util.getMessageProperty(msg, node.config.property);
    const numValue = Number(value);
    
    if (isNaN(numValue)) {
      node.error('Property is not a number', msg);
      return null;
    }
    
    const { minin, maxin, minout, maxout } = node.config;
    let result = ((numValue - minin) / (maxin - minin)) * (maxout - minout) + minout;
    
    if (node.config.round) {
      result = Math.round(result);
    }
    
    RED.util.setMessageProperty(msg, node.config.property, result);
    return msg;
  }
});

// ===================================================================
// PARSER NODES
// ===================================================================

// JSON Node (already exists)
registry.register('json', {
  type: 'json',
  category: 'parser',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    property: { value: 'payload' },
    action: { value: '' }
  },
  inputs: 1,
  outputs: 1,
  execute: async (msg: NodeMessage, node: Node) => {
    const prop = node.config.property || 'payload';
    const value = RED.util.getMessageProperty(msg, prop);
    
    try {
      if (node.config.action === 'str' || 
          (node.config.action === '' && typeof value === 'object')) {
        RED.util.setMessageProperty(msg, prop, JSON.stringify(value));
      } else if (node.config.action === 'obj' || 
                 (node.config.action === '' && typeof value === 'string')) {
        RED.util.setMessageProperty(msg, prop, JSON.parse(value));
      }
    } catch (err: any) {
      node.error('JSON conversion failed: ' + err.message, msg);
      return null;
    }
    
    return msg;
  }
});

// CSV Parser Node
registry.register('csv', {
  type: 'csv',
  category: 'parser',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    sep: { value: ',' },
    hdrin: { value: false },
    hdrout: { value: 'none' }
  },
  inputs: 1,
  outputs: 1,
  execute: async (msg: NodeMessage, node: Node) => {
    const payload = msg.payload;
    
    // CSV to Object
    if (typeof payload === 'string') {
      const lines = payload.split('\n').filter(l => l.trim());
      const sep = node.config.sep || ',';
      
      if (node.config.hdrin) {
        const headers = lines[0].split(sep).map(h => h.trim());
        const result = lines.slice(1).map(line => {
          const values = line.split(sep).map(v => v.trim());
          const obj: any = {};
          headers.forEach((h, i) => obj[h] = values[i]);
          return obj;
        });
        msg.payload = result;
      } else {
        msg.payload = lines.map(line => line.split(sep).map(v => v.trim()));
      }
    }
    // Object to CSV
    else if (Array.isArray(payload)) {
      const sep = node.config.sep || ',';
      let csv = '';
      
      if (payload.length > 0 && typeof payload[0] === 'object') {
        const headers = Object.keys(payload[0]);
        if (node.config.hdrout !== 'none') {
          csv = headers.join(sep) + '\n';
        }
        csv += payload.map(obj => 
          headers.map(h => obj[h]).join(sep)
        ).join('\n');
      } else {
        csv = payload.map(row => 
          Array.isArray(row) ? row.join(sep) : row
        ).join('\n');
      }
      
      msg.payload = csv;
    }
    
    return msg;
  }
});

// ===================================================================
// STORAGE NODES
// ===================================================================

// File/Storage Node - Store data in DO storage
registry.register('file', {
  type: 'file',
  category: 'storage',
  color: '#ff9999',
  defaults: {
    name: { value: '' },
    filename: { value: '' },
    action: { value: 'write' },
    append: { value: false }
  },
  inputs: 1,
  outputs: 1,
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const filename = node.config.filename || msg.filename || 'file.txt';
    const key = `file:${filename}`;
    
    try {
      if (node.config.action === 'write') {
        let content = msg.payload;
        
        if (node.config.append) {
          const existing = await context.storage.get(key) || '';
          content = existing + content;
        }
        
        await context.storage.put(key, content);
        msg.payload = `Wrote to ${filename}`;
      } else if (node.config.action === 'read') {
        const content = await context.storage.get(key);
        msg.payload = content || null;
      } else if (node.config.action === 'delete') {
        await context.storage.delete(key);
        msg.payload = `Deleted ${filename}`;
      }
      
      return msg;
    } catch (err: any) {
      node.error(err.message, msg);
      return null;
    }
  }
});

// ===================================================================
// UTILITY NODES
// ===================================================================

// Delay Node
registry.register('delay', {
  type: 'delay',
  category: 'function',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    pauseType: { value: 'delay' },
    timeout: { value: 1 },
    timeoutUnits: { value: 'seconds' }
  },
  inputs: 1,
  outputs: 1,
  execute: async (msg: NodeMessage, node: Node) => {
    let delay = node.config.timeout || 1;
    
    switch (node.config.timeoutUnits) {
      case 'milliseconds':
        break;
      case 'seconds':
        delay *= 1000;
        break;
      case 'minutes':
        delay *= 60000;
        break;
      case 'hours':
        delay *= 3600000;
        break;
    }
    
    await new Promise(resolve => setTimeout(resolve, delay));
    return msg;
  }
});

// Trigger Node - Send message after delay
registry.register('trigger', {
  type: 'trigger',
  category: 'function',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    op1: { value: '1' },
    op2: { value: '0' },
    op1type: { value: 'str' },
    op2type: { value: 'str' },
    duration: { value: '250' },
    extend: { value: false }
  },
  inputs: 1,
  outputs: 1,
  execute: async (msg: NodeMessage, node: Node) => {
    // Send first output immediately
    const msg1 = RED.util.cloneMessage(msg);
    msg1.payload = node.config.op1type === 'str' ? node.config.op1 : 
                   node.config.op1type === 'num' ? Number(node.config.op1) :
                   node.config.op1type === 'bool' ? node.config.op1 === 'true' : node.config.op1;
    
    node.send(msg1);
    
    // Send second output after delay
    if (node.config.op2 !== '') {
      await new Promise(resolve => setTimeout(resolve, Number(node.config.duration)));
      
      const msg2 = RED.util.cloneMessage(msg);
      msg2.payload = node.config.op2type === 'str' ? node.config.op2 : 
                     node.config.op2type === 'num' ? Number(node.config.op2) :
                     node.config.op2type === 'bool' ? node.config.op2 === 'true' : node.config.op2;
      
      return msg2;
    }
    
    return null;
  }
});

// Batch/Join Node - Combine messages
registry.register('join', {
  type: 'join',
  category: 'function',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    mode: { value: 'auto' },
    count: { value: 2 },
    timeout: { value: 0 }
  },
  inputs: 1,
  outputs: 1,
  onInit: async (node: Node, context: ExecutionContext) => {
    await context.storage.put(`join:${node.id}:messages`, []);
  },
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const key = `join:${node.id}:messages`;
    const messages: NodeMessage[] = await context.storage.get(key) || [];
    
    messages.push(msg);
    
    if (messages.length >= (node.config.count || 2)) {
      await context.storage.put(key, []);
      const result = RED.util.cloneMessage(msg);
      result.payload = messages.map(m => m.payload);
      result.parts = {
        id: msg.parts?.id || RED.util.generateId(),
        count: messages.length,
        index: 0,
        type: 'array'
      };
      return result;
    }
    
    await context.storage.put(key, messages);
    return null;
  }
});

// Split Node - Split arrays/objects
registry.register('split', {
  type: 'split',
  category: 'function',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    splt: { value: '\\n' },
    spltType: { value: 'str' }
  },
  inputs: 1,
  outputs: 1,
  execute: async (msg: NodeMessage, node: Node) => {
    const payload = msg.payload;
    const results: NodeMessage[] = [];
    const partsId = RED.util.generateId();
    
    if (Array.isArray(payload)) {
      payload.forEach((item, index) => {
        const newMsg = RED.util.cloneMessage(msg);
        newMsg.payload = item;
        newMsg.parts = {
          id: partsId,
          index,
          count: payload.length,
          type: 'array'
        };
        results.push(newMsg);
      });
    } else if (typeof payload === 'object' && payload !== null) {
      const keys = Object.keys(payload);
      keys.forEach((key, index) => {
        const newMsg = RED.util.cloneMessage(msg);
        newMsg.payload = payload[key];
        newMsg.parts = {
          id: partsId,
          index,
          count: keys.length,
          type: 'object',
          key
        };
        results.push(newMsg);
      });
    } else if (typeof payload === 'string') {
      const separator = node.config.splt || '\n';
      const parts = payload.split(separator);
      parts.forEach((part, index) => {
        const newMsg = RED.util.cloneMessage(msg);
        newMsg.payload = part;
        newMsg.parts = {
          id: partsId,
          index,
          count: parts.length,
          type: 'string'
        };
        results.push(newMsg);
      });
    }
    
    return results;
  }
});

// ===================================================================
// DEBUG & MONITORING
// ===================================================================

// Debug Node (already exists)
registry.register('debug', {
  type: 'debug',
  category: 'output',
  color: '#87a980',
  defaults: { 
    name: { value: '' }, 
    active: { value: true }, 
    complete: { value: 'payload' },
    console: { value: false }
  },
  inputs: 1,
  outputs: 0,
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    if (!node.config.active) return null;
    
    const output = node.config.complete === 'true' 
      ? msg 
      : RED.util.getMessageProperty(msg, node.config.complete);
    
    if (node.config.console) {
      console.log(`[DEBUG ${node.name || node.id}]`, output);
    }
    
    const debugKey = `debug:${node.id}:${Date.now()}`;
    await context.storage.put(debugKey, {
      timestamp: Date.now(),
      output,
      msgid: msg._msgid,
      nodeId: node.id
    });
    
    return null;
  }
});

// Catch Node - Error handling
registry.register('catch', {
  type: 'catch',
  category: 'input',
  color: '#e7e7ae',
  defaults: {
    name: { value: '' },
    scope: { value: [] }
  },
  inputs: 0,
  outputs: 1,
  execute: async (msg: NodeMessage) => {
    // This is triggered by the flow engine when errors occur
    return msg;
  }
});

// Status Node - Monitor node status
registry.register('status', {
  type: 'status',
  category: 'input',
  color: '#e7e7ae',
  defaults: {
    name: { value: '' },
    scope: { value: [] }
  },
  inputs: 0,
  outputs: 1,
  execute: async (msg: NodeMessage) => {
    // This is triggered by the flow engine when status changes
    return msg;
  }
});
