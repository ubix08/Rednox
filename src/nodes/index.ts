
// ===================================================================
// RedNox - Enhanced Node Implementations with Safety
// ===================================================================

import { registry } from '../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext } from '../types/core';
import { RED, evaluateProperty, executeSafeFunction, StorageKeys } from '../utils';

// ===================================================================
// HTTP NODES
// ===================================================================

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

registry.register('http-response', {
  type: 'http-response',
  category: 'output',
  color: '#e7e7ae',
  defaults: { name: { value: '' }, statusCode: { value: '' }, headers: { value: {} } },
  inputs: 1,
  outputs: 0,
  execute: async (msg: NodeMessage, node: Node) => {
    const headers = { 'Content-Type': 'application/json', ...msg.headers };
    
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
// FUNCTION NODE - Enhanced with Safety
// ===================================================================

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
      const result = await executeSafeFunction(node.config.func, {
        msg,
        node,
        context: node.context(),
        flow: node.context().flow,
        global: node.context().global,
        env: context.env
      });
      
      return result === undefined || result === null ? null : result;
    } catch (error: any) {
      node.error(error, msg);
      return null;
    }
  }
});

// ===================================================================
// SWITCH NODE
// ===================================================================

registry.register('switch', {
  type: 'switch',
  category: 'function',
  color: '#fdd0a2',
  defaults: { 
    name: { value: '' }, 
    property: { value: 'payload' },
    rules: { value: [{ t: 'eq', v: '', vt: 'str' }] },
    checkall: { value: true }
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
        case 'eq': match = property == ruleValue; break;
        case 'neq': match = property != ruleValue; break;
        case 'lt': match = Number(property) < Number(ruleValue); break;
        case 'lte': match = Number(property) <= Number(ruleValue); break;
        case 'gt': match = Number(property) > Number(ruleValue); break;
        case 'gte': match = Number(property) >= Number(ruleValue); break;
        case 'btwn':
          const val = Number(property);
          match = val >= Number(rule.v) && val <= Number(rule.v2);
          break;
        case 'cont': match = String(property).includes(String(ruleValue)); break;
        case 'regex': match = new RegExp(String(ruleValue)).test(String(property)); break;
        case 'true': match = !!property; break;
        case 'false': match = !property; break;
        case 'null': match = property === null; break;
        case 'nnull': match = property !== null; break;
        case 'empty':
          match = property === '' || property === null || property === undefined ||
                  (Array.isArray(property) && property.length === 0);
          break;
        case 'nempty':
          match = property !== '' && property !== null && property !== undefined &&
                  !(Array.isArray(property) && property.length === 0);
          break;
        case 'istype': match = typeof property === ruleValue; break;
      }
      
      results.push(match ? RED.util.cloneMessage(msg) : null);
      if (match && !node.config.checkall) break;
    }
    
    return results;
  }
});

// ===================================================================
// CHANGE NODE
// ===================================================================

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

// ===================================================================
// PARSER NODES
// ===================================================================

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
    const sep = node.config.sep || ',';
    
    if (typeof payload === 'string') {
      const lines = payload.split('\n').filter(l => l.trim());
      
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
    } else if (Array.isArray(payload)) {
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
// UTILITY NODES
// ===================================================================

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
      case 'milliseconds': break;
      case 'seconds': delay *= 1000; break;
      case 'minutes': delay *= 60000; break;
      case 'hours': delay *= 3600000; break;
    }
    
    await new Promise(resolve => setTimeout(resolve, delay));
    return msg;
  }
});

registry.register('split', {
  type: 'split',
  category: 'function',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    splt: { value: '\\n' }
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
        newMsg.parts = { id: partsId, index, count: payload.length, type: 'array' };
        results.push(newMsg);
      });
    } else if (typeof payload === 'object' && payload !== null) {
      const keys = Object.keys(payload);
      keys.forEach((key, index) => {
        const newMsg = RED.util.cloneMessage(msg);
        newMsg.payload = payload[key];
        newMsg.parts = { id: partsId, index, count: keys.length, type: 'object', key };
        results.push(newMsg);
      });
    } else if (typeof payload === 'string') {
      const separator = node.config.splt || '\n';
      const parts = payload.split(separator);
      parts.forEach((part, index) => {
        const newMsg = RED.util.cloneMessage(msg);
        newMsg.payload = part;
        newMsg.parts = { id: partsId, index, count: parts.length, type: 'string' };
        results.push(newMsg);
      });
    }
    
    return results;
  }
});

registry.register('join', {
  type: 'join',
  category: 'function',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    mode: { value: 'auto' },
    count: { value: 2 }
  },
  inputs: 1,
  outputs: 1,
  onInit: async (node: Node, context: ExecutionContext) => {
    await context.batchedStorage?.set(StorageKeys.join(node.id), []);
  },
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const key = StorageKeys.join(node.id);
    const messages: NodeMessage[] = await context.batchedStorage?.get(key) || [];
    
    messages.push(msg);
    
    if (messages.length >= (node.config.count || 2)) {
      await context.batchedStorage?.set(key, []);
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
    
    await context.batchedStorage?.set(key, messages);
    return null;
  }
});

// ===================================================================
// DEBUG NODE
// ===================================================================

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
    
    const debugKey = StorageKeys.debug(node.id, Date.now());
    await context.batchedStorage?.set(debugKey, {
      timestamp: Date.now(),
      output,
      msgid: msg._msgid,
      nodeId: node.id
    });
    
    return null;
  }
});

// ===================================================================
// ERROR HANDLING NODES
// ===================================================================

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
  execute: async (msg: NodeMessage) => msg
});

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
  execute: async (msg: NodeMessage) => msg
});
