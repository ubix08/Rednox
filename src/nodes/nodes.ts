
// ===================================================================
// RedNox - Complete Standard Node-RED Compatible Nodes
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
  defaults: { 
    method: { value: 'get' }, 
    url: { value: '/' }, 
    name: { value: '' } 
  },
  inputs: 0,
  outputs: 1,
  icon: 'white-globe.svg',
  execute: async (msg: NodeMessage) => msg
});

registry.register('http-response', {
  type: 'http-response',
  category: 'output',
  color: '#e7e7ae',
  defaults: { 
    name: { value: '' }, 
    statusCode: { value: '' }, 
    headers: { value: {} } 
  },
  inputs: 1,
  outputs: 0,
  icon: 'white-globe.svg',
  execute: async (msg: NodeMessage, node: Node) => {
    let payload = msg.payload;
    let contentType = 'application/json';
    
    // Determine content type
    if (typeof payload === 'string') {
      // Check if it looks like HTML
      if (payload.trim().startsWith('<')) {
        contentType = 'text/html';
      } else {
        contentType = 'text/plain';
      }
    } else if (payload instanceof Uint8Array || payload instanceof ArrayBuffer) {
      contentType = 'application/octet-stream';
    }
    
    // Allow override from message
    if (msg.headers?.['content-type']) {
      contentType = msg.headers['content-type'];
    }
    
    // Stringify objects for JSON
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
  }
});

registry.register('http-request', {
  type: 'http-request',
  category: 'function',
  color: '#e7e7ae',
  defaults: {
    name: { value: '' },
    method: { value: 'GET' },
    url: { value: '' },
    timeout: { value: 30000 },
    headers: { value: {} },
    ret: { value: 'txt' }, // txt, bin, obj
    tls: { value: '' }
  },
  inputs: 1,
  outputs: 1,
  icon: 'white-globe.svg',
  execute: async (msg: NodeMessage, node: Node) => {
    const url = node.config.url || msg.url;
    const method = (node.config.method || msg.method || 'GET').toUpperCase();
    const headers: Record<string, string> = { ...node.config.headers };
    
    if (!url) {
      node.error('No URL specified', msg);
      return null;
    }
    
    // Merge message headers
    if (msg.headers) {
      Object.assign(headers, msg.headers);
    }
    
    // Set content-type for non-GET requests
    if (method !== 'GET' && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }
    
    try {
      const options: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(node.config.timeout || 30000)
      };
      
      // Add body for non-GET requests
      if (method !== 'GET' && method !== 'HEAD' && msg.payload !== undefined) {
        if (typeof msg.payload === 'string') {
          options.body = msg.payload;
        } else {
          options.body = JSON.stringify(msg.payload);
        }
      }
      
      const response = await fetch(url, options);
      
      // Store response metadata
      msg.statusCode = response.status;
      msg.headers = Object.fromEntries(response.headers);
      msg.responseUrl = response.url;
      
      // Parse response based on return type
      const contentType = response.headers.get('content-type') || '';
      
      if (node.config.ret === 'bin') {
        msg.payload = new Uint8Array(await response.arrayBuffer());
      } else if (node.config.ret === 'obj' || contentType.includes('application/json')) {
        try {
          msg.payload = await response.json();
        } catch {
          msg.payload = await response.text();
        }
      } else {
        msg.payload = await response.text();
      }
      
      return msg;
      
    } catch (err: any) {
      node.error(`HTTP request failed: ${err.message}`, msg);
      msg.payload = { error: err.message };
      msg.statusCode = 0;
      return msg;
    }
  }
});

// ===================================================================
// INJECT NODE (Manual/Scheduled Trigger)
// ===================================================================

registry.register('inject', {
  type: 'inject',
  category: 'input',
  color: '#e7e7ae',
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
  icon: 'inject.svg',
  
  onInit: async (node: Node, context: ExecutionContext) => {
    if (node.config.repeat || node.config.crontab) {
      const schedule = {
        nodeId: node.id,
        flowId: '',
        repeat: true,
        cron: node.config.crontab,
        interval: node.config.repeat ? parseInt(node.config.repeat) * 1000 : undefined,
        nextRun: Date.now()
      };
      
      await context.storage.put(StorageKeys.schedule(node.id), schedule);
      node.log(`Scheduled: ${node.config.crontab || node.config.repeat + 's'}`);
    }
  },
  
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
  }
});

// ===================================================================
// FUNCTION NODE
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
  icon: 'function.svg',
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    try {
      const result = await executeSafeFunction(node.config.func, {
        msg,
        node,
        context: node.context(),
        flow: node.context().flow,
        global: node.context().global,
        env: context.env,
        RED
      });
      
      return result === undefined || result === null ? null : result;
    } catch (error: any) {
      node.error(error, msg);
      return null;
    }
  }
});

// ===================================================================
// TEMPLATE NODE (Mustache-like templating)
// ===================================================================

registry.register('template', {
  type: 'template',
  category: 'function',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    field: { value: 'payload' },
    fieldType: { value: 'msg' },
    template: { value: '' },
    syntax: { value: 'mustache' },
    output: { value: 'str' }
  },
  inputs: 1,
  outputs: 1,
  icon: 'template.svg',
  execute: async (msg: NodeMessage, node: Node) => {
    let result = node.config.template || '';
    
    try {
      // Simple Mustache-like template engine
      // Replace {{msg.property}} with actual values
      result = result.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
        path = path.trim();
        
        // Handle msg.property
        if (path.startsWith('msg.')) {
          const value = RED.util.getMessageProperty(msg, path.substring(4));
          return value !== undefined ? String(value) : '';
        }
        
        // Handle just property name (assumes msg.property)
        const value = RED.util.getMessageProperty(msg, path);
        return value !== undefined ? String(value) : '';
      });
      
      // Handle output type
      if (node.config.output === 'json') {
        try {
          result = JSON.parse(result);
        } catch (err) {
          node.error('Template output is not valid JSON', msg);
          return null;
        }
      }
      
      RED.util.setMessageProperty(msg, node.config.field, result);
      return msg;
      
    } catch (err: any) {
      node.error(`Template error: ${err.message}`, msg);
      return null;
    }
  }
});

// ===================================================================
// CONTEXT NODE (Memory/Storage)
// ===================================================================

registry.register('context', {
  type: 'context',
  category: 'storage',
  color: '#7CB9E8',
  defaults: {
    name: { value: '' },
    operation: { value: 'get' },
    scope: { value: 'flow' },
    key: { value: '' },
    value: { value: '' }
  },
  inputs: 1,
  outputs: 1,
  icon: 'function.svg',
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const operation = node.config.operation;
    const scope = node.config.scope;
    const key = node.config.key || msg.key;
    
    const store = scope === 'flow' ? context.flow : context.global;
    
    try {
      if (operation === 'get') {
        msg.payload = await store.get(key);
      } else if (operation === 'set') {
        const value = node.config.value !== undefined ? node.config.value : msg.payload;
        await store.set(key, value);
      } else if (operation === 'keys') {
        msg.payload = await store.keys();
      } else if (operation === 'delete') {
        const storageKey = scope === 'flow' ? StorageKeys.flow(key) : StorageKeys.global(key);
        await context.storage.delete(storageKey);
        msg.payload = { deleted: true, key };
      }
      
      node.status({ fill: 'green', shape: 'dot', text: `${operation}: ${key}` });
      return msg;
      
    } catch (err: any) {
      node.error(err, msg);
      return null;
    }
  }
});

// ===================================================================
// SWITCH NODE (Enhanced)
// ===================================================================

registry.register('switch', {
  type: 'switch',
  category: 'function',
  color: '#fdd0a2',
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
  icon: 'switch.svg',
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
          try {
            match = new RegExp(String(ruleValue), rule.case ? '' : 'i').test(String(property));
          } catch {
            match = false;
          }
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
                  (Array.isArray(property) && property.length === 0) ||
                  (typeof property === 'object' && Object.keys(property).length === 0);
          break;
        case 'nempty':
          match = !(property === '' || property === null || property === undefined ||
                  (Array.isArray(property) && property.length === 0) ||
                  (typeof property === 'object' && Object.keys(property).length === 0));
          break;
        case 'istype': 
          match = typeof property === ruleValue; 
          break;
        case 'head':
          // First N messages
          const headCount = Number(ruleValue) || 1;
          const headKey = StorageKeys.node(node.id, 'count');
          const currentCount = (await context.storage.get(headKey)) || 0;
          match = currentCount < headCount;
          await context.storage.put(headKey, currentCount + 1);
          break;
        case 'tail':
          // Not implemented (requires message buffering)
          match = false;
          break;
        case 'index':
          // Message at specific index
          if (msg.parts) {
            const indices = String(ruleValue).split(',').map(i => Number(i.trim()));
            match = indices.includes(msg.parts.index);
          }
          break;
        case 'else':
          // Else matches if no previous rule matched
          match = !results.some(r => r !== null);
          break;
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
  icon: 'change.svg',
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
        } else if (rule.t === 'change') {
          // String replacement
          const currentValue = String(RED.util.getMessageProperty(msg, rule.p));
          const from = String(rule.from);
          const to = String(rule.to);
          const newValue = rule.re ? 
            currentValue.replace(new RegExp(from, 'g'), to) :
            currentValue.split(from).join(to);
          RED.util.setMessageProperty(msg, rule.p, newValue);
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
  icon: 'parser-json.svg',
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
    hdrout: { value: 'none' },
    multi: { value: 'one' }
  },
  inputs: 1,
  outputs: 1,
  icon: 'parser-csv.svg',
  execute: async (msg: NodeMessage, node: Node) => {
    const { sep, hdrin } = node.config;
    const input = msg.payload;
    
    try {
      if (typeof input === 'string') {
        // Parse CSV to array/object
        const lines = input.split('\n').filter(l => l.trim());
        const headers = hdrin ? lines[0].split(sep) : null;
        const dataLines = hdrin ? lines.slice(1) : lines;
        
        msg.payload = dataLines.map(line => {
          const values = line.split(sep);
          if (headers) {
            return headers.reduce((obj, h, i) => {
              obj[h.trim()] = values[i]?.trim();
              return obj;
            }, {} as Record<string, string>);
          }
          return values.map(v => v.trim());
        });
      } else if (Array.isArray(input)) {
        // Convert array to CSV
        const lines: string[] = [];
        
        // Add headers if objects
        if (input.length > 0 && typeof input[0] === 'object' && !Array.isArray(input[0])) {
          const headers = Object.keys(input[0]);
          lines.push(headers.join(sep));
          
          input.forEach(row => {
            lines.push(headers.map(h => String(row[h] || '')).join(sep));
          });
        } else {
          // Array of arrays or primitives
          input.forEach(row => {
            if (Array.isArray(row)) {
              lines.push(row.join(sep));
            } else {
              lines.push(String(row));
            }
          });
        }
        
        msg.payload = lines.join('\n');
      }
      
      return msg;
    } catch (err: any) {
      node.error('CSV conversion failed: ' + err.message, msg);
      return null;
    }
  }
});

registry.register('html', {
  type: 'html',
  category: 'parser',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    property: { value: 'payload' },
    tag: { value: '' },
    ret: { value: 'text' }
  },
  inputs: 1,
  outputs: 1,
  icon: 'parser-html.svg',
  execute: async (msg: NodeMessage, node: Node) => {
    const html = RED.util.getMessageProperty(msg, node.config.property);
    
    if (typeof html !== 'string') {
      node.error('Input must be a string', msg);
      return null;
    }
    
    try {
      // Simple tag extraction (basic implementation)
      const tag = node.config.tag;
      if (!tag) {
        msg.payload = html;
        return msg;
      }
      
      const regex = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'gs');
      const matches = [...html.matchAll(regex)];
      
      msg.payload = matches.map(m => {
        if (node.config.ret === 'text') {
          return m[1].replace(/<[^>]+>/g, '').trim();
        }
        return m[1];
      });
      
      return msg;
    } catch (err: any) {
      node.error('HTML parsing failed: ' + err.message, msg);
      return null;
    }
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
    timeoutUnits: { value: 'seconds' },
    rate: { value: 1 },
    nbRateUnits: { value: 1 },
    rateUnits: { value: 'second' }
  },
  inputs: 1,
  outputs: 1,
  icon: 'timer.svg',
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
    extend: { value: false },
    units: { value: 'ms' }
  },
  inputs: 1,
  outputs: 1,
  icon: 'trigger.svg',
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    // Send first output immediately
    const msg1 = RED.util.cloneMessage(msg);
    
    // Parse op1 value
    if (node.config.op1type === 'pay') {
      msg1.payload = msg.payload;
    } else {
      msg1.payload = node.config.op1;
    }
    
    // Send second output after duration
    let duration = Number(node.config.duration);
    if (node.config.units === 's') duration *= 1000;
    if (node.config.units === 'm') duration *= 60000;
    
    context.storage.put(StorageKeys.node(node.id, 'timeout'), {
      timeout: setTimeout(() => {
        const msg2 = RED.util.cloneMessage(msg);
        msg2.payload = node.config.op2;
        node.send(msg2);
      }, duration)
    });
    
    return msg1;
  }
});

registry.register('split', {
  type: 'split',
  category: 'sequence',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    splt: { value: '\\n' },
    spltType: { value: 'str' },
    arraySplt: { value: 1 },
    stream: { value: false }
  },
  inputs: 1,
  outputs: 1,
  icon: 'split.svg',
  execute: async (msg: NodeMessage, node: Node) => {
    const payload = msg.payload;
    const results: NodeMessage[] = [];
    const partsId = RED.util.generateId();
    
    if (Array.isArray(payload)) {
      const arraySplt = node.config.arraySplt || 1;
      for (let i = 0; i < payload.length; i += arraySplt) {
        const newMsg = RED.util.cloneMessage(msg);
        newMsg.payload = arraySplt === 1 ? payload[i] : payload.slice(i, i + arraySplt);
        newMsg.parts = { 
          id: partsId, 
          index: Math.floor(i / arraySplt), 
          count: Math.ceil(payload.length / arraySplt), 
          type: 'array' 
        };
        results.push(newMsg);
      }
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
        newMsg.parts = { id: partsId, index, count: parts.length, type: 'string', ch: separator };
        results.push(newMsg);
      });
    }
    
    return results;
  }
});

registry.register('join', {
  type: 'join',
  category: 'sequence',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    mode: { value: 'auto' },
    build: { value: 'object' },
    property: { value: 'payload' },
    propertyType: { value: 'msg' },
    count: { value: '' },
    timeout: { value: '' }
  },
  inputs: 1,
  outputs: 1,
  icon: 'join.svg',
  onInit: async (node: Node, context: ExecutionContext) => {
    await context.storage.put(StorageKeys.join(node.id), []);
  },
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const key = StorageKeys.join(node.id);
    const messages: NodeMessage[] = await context.storage.get(key) || [];
    
    messages.push(msg);
    
    let shouldComplete = false;
    
    // Auto mode - use msg.parts
    if (node.config.mode === 'auto' && msg.parts) {
      shouldComplete = messages.length >= msg.parts.count;
    } 
    // Count mode
    else if (node.config.mode === 'custom' && node.config.count) {
      shouldComplete = messages.length >= Number(node.config.count);
    }
    
    if (shouldComplete) {
      await context.storage.put(key, []);
      const result = RED.util.cloneMessage(msg);
      
      // Build result based on mode
      if (node.config.build === 'array') {
        result.payload = messages.map(m => m.payload);
      } else if (node.config.build === 'object') {
        result.payload = messages.reduce((obj, m) => {
          if (m.parts?.key) {
            obj[m.parts.key] = m.payload;
          }
          return obj;
        }, {} as Record<string, any>);
      } else if (node.config.build === 'string') {
        const sep = msg.parts?.ch || '';
        result.payload = messages.map(m => m.payload).join(sep);
      } else if (node.config.build === 'merged') {
        result.payload = messages.reduce((merged, m) => {
          return Object.assign(merged, m.payload);
        }, {});
      }
      
      result.parts = {
        id: msg.parts?.id || RED.util.generateId(),
        count: messages.length,
        index: 0,
        type: node.config.build
      };
      return result;
    }
    
    await context.storage.put(key, messages);
    return null;
  }
});

registry.register('sort', {
  type: 'sort',
  category: 'sequence',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    target: { value: 'payload' },
    targetType: { value: 'msg' },
    msgKey: { value: 'payload' },
    msgKeyType: { value: 'elem' },
    order: { value: 'ascending' },
    as_num: { value: false }
  },
  inputs: 1,
  outputs: 1,
  icon: 'sort.svg',
  execute: async (msg: NodeMessage, node: Node) => {
    const arr = RED.util.getMessageProperty(msg, node.config.target);
    
    if (!Array.isArray(arr)) {
      node.error('Target is not an array', msg);
      return msg;
    }
    
    const sorted = [...arr].sort((a, b) => {
      let aVal = a;
      let bVal = b;
      
      // Extract values if sorting objects
      if (node.config.msgKeyType === 'elem' && node.config.msgKey) {
        aVal = a[node.config.msgKey];
        bVal = b[node.config.msgKey];
      }
      
      // Convert to numbers if needed
      if (node.config.as_num) {
        aVal = Number(aVal);
        bVal = Number(bVal);
      }
      
      if (node.config.order === 'ascending') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
    
    RED.util.setMessageProperty(msg, node.config.target, sorted);
    return msg;
  }
});

registry.register('batch', {
  type: 'batch',
  category: 'sequence',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    mode: { value: 'count' },
    count: { value: 10 },
    overlap: { value: 0 },
    interval: { value: 10 }
  },
  inputs: 1,
  outputs: 1,
  icon: 'batch.svg',
  onInit: async (node: Node, context: ExecutionContext) => {
    await context.storage.put(StorageKeys.node(node.id, 'batch'), []);
  },
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const key = StorageKeys.node(node.id, 'batch');
    const batch: NodeMessage[] = await context.storage.get(key) || [];
    
    batch.push(msg);
    
    if (node.config.mode === 'count' && batch.length >= node.config.count) {
      await context.storage.put(key, []);
      const result = RED.util.cloneMessage(msg);
      result.payload = batch.map(m => m.payload);
      return result;
    }
    
    await context.storage.put(key, batch);
    return null;
  }
});

// ===================================================================
// RANGE NODE (Value Scaling)
// ===================================================================

registry.register('range', {
  type: 'range',
  category: 'function',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    property: { value: 'payload' },
    minin: { value: '0' },
    maxin: { value: '100' },
    minout: { value: '0' },
    maxout: { value: '1' },
    action: { value: 'scale' },
    round: { value: false }
  },
  inputs: 1,
  outputs: 1,
  icon: 'range.svg',
  execute: async (msg: NodeMessage, node: Node) => {
    const value = Number(RED.util.getMessageProperty(msg, node.config.property));
    const { minin, maxin, minout, maxout } = node.config;
    
    if (isNaN(value)) {
      node.error('Value is not a number', msg);
      return null;
    }
    
    let result: number;
    
    if (node.config.action === 'clamp') {
      result = Math.max(Number(minout), Math.min(Number(maxout), value));
    } else {
      // Scale
      const scaled = ((value - Number(minin)) / (Number(maxin) - Number(minin))) * 
                     (Number(maxout) - Number(minout)) + Number(minout);
      result = node.config.round ? Math.round(scaled) : scaled;
    }
    
    RED.util.setMessageProperty(msg, node.config.property, result);
    return msg;
  }
});

// ===================================================================
// RBE (Report By Exception)
// ===================================================================

registry.register('rbe', {
  type: 'rbe',
  category: 'function',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    func: { value: 'rbe' },
    property: { value: 'payload' },
    gap: { value: '' },
    start: { value: '' },
    inout: { value: 'out' }
  },
  inputs: 1,
  outputs: 1,
  icon: 'rbe.svg',
  onInit: async (node: Node, context: ExecutionContext) => {
    await context.storage.put(StorageKeys.node(node.id, 'last'), null);
  },
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    const current = RED.util.getMessageProperty(msg, node.config.property);
    const last = await context.storage.get(StorageKeys.node(node.id, 'last'));
    
    let shouldSend = false;
    
    if (node.config.func === 'rbe') {
      // Report by exception - only on change
      shouldSend = current !== last;
    } else if (node.config.func === 'deadband') {
      // Deadband - only if change exceeds gap
      if (last === null) {
        shouldSend = true;
      } else {
        const gap = Number(node.config.gap) || 0;
        shouldSend = Math.abs(Number(current) - Number(last)) >= gap;
      }
    } else if (node.config.func === 'narrowband') {
      // Narrowband - only within band
      const gap = Number(node.config.gap) || 0;
      shouldSend = Math.abs(Number(current) - Number(last)) <= gap;
    }
    
    if (shouldSend) {
      await context.storage.put(StorageKeys.node(node.id, 'last'), current);
      return msg;
    }
    
    return null;
  }
});

// ===================================================================
// LINK NODES (Flow Linking)
// ===================================================================

registry.register('link in', {
  type: 'link in',
  category: 'input',
  color: '#ddd',
  defaults: {
    name: { value: '' },
    links: { value: [] }
  },
  inputs: 0,
  outputs: 1,
  icon: 'link-out.svg',
  execute: async (msg: NodeMessage) => msg
});

registry.register('link out', {
  type: 'link out',
  category: 'output',
  color: '#ddd',
  defaults: {
    name: { value: '' },
    links: { value: [] },
    mode: { value: 'link' }
  },
  inputs: 1,
  outputs: 0,
  icon: 'link-out.svg',
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    // Send to all linked link-in nodes
    if (context.flowEngine) {
      for (const linkId of node.config.links || []) {
        await context.flowEngine.executeNode(linkId, RED.util.cloneMessage(msg));
      }
    }
    return null;
  }
});

registry.register('link call', {
  type: 'link call',
  category: 'function',
  color: '#ddd',
  defaults: {
    name: { value: '' },
    links: { value: [] },
    timeout: { value: 30 }
  },
  inputs: 1,
  outputs: 1,
  icon: 'link-out.svg',
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    // This would require implementing a response mechanism
    // For now, just pass through
    node.warn('link call not fully implemented');
    return msg;
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
    console: { value: false },
    tosidebar: { value: true },
    tostatus: { value: false }
  },
  inputs: 1,
  outputs: 0,
  icon: 'debug.svg',
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    if (!node.config.active) return null;
    
    const output = node.config.complete === 'true' 
      ? msg 
      : RED.util.getMessageProperty(msg, node.config.complete);
    
    if (node.config.console) {
      console.log(`[DEBUG ${node.name || node.id}]`, output);
    }
    
    if (node.config.tosidebar) {
      const debugKey = StorageKeys.debug(node.id, Date.now());
      await context.storage.put(debugKey, {
        timestamp: Date.now(),
        output,
        msgid: msg._msgid,
        nodeId: node.id
      });
    }
    
    if (node.config.tostatus) {
      const statusText = typeof output === 'object' 
        ? JSON.stringify(output).substring(0, 32)
        : String(output).substring(0, 32);
      node.status({ fill: 'grey', shape: 'dot', text: statusText });
    }
    
    return null;
  }
});

registry.register('complete', {
  type: 'complete',
  category: 'input',
  color: '#e7e7ae',
  defaults: {
    name: { value: '' },
    scope: { value: [] }
  },
  inputs: 0,
  outputs: 1,
  icon: 'complete.svg',
  execute: async (msg: NodeMessage) => msg
});

registry.register('comment', {
  type: 'comment',
  category: 'common',
  color: '#ffffff',
  defaults: {
    name: { value: '' },
    info: { value: '' }
  },
  inputs: 0,
  outputs: 0,
  execute: async () => null
});

// ===================================================================
// ERROR HANDLING
// ===================================================================

registry.register('catch', {
  type: 'catch',
  category: 'input',
  color: '#e7e7ae',
  defaults: {
    name: { value: '' },
    scope: { value: [] },
    uncaught: { value: false }
  },
  inputs: 0,
  outputs: 1,
  icon: 'catch.svg',
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
  icon: 'status.svg',
  execute: async (msg: NodeMessage) => msg
});

// ===================================================================
// STORAGE/FILE NODES (with R2 support)
// ===================================================================

registry.register('file', {
  type: 'file',
  category: 'storage',
  color: '#7CB9E8',
  defaults: {
    name: { value: '' },
    filename: { value: '' },
    filenameType: { value: 'str' },
    action: { value: 'write' },
    encoding: { value: 'utf8' }
  },
  inputs: 1,
  outputs: 1,
  icon: 'file.svg',
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    // Requires R2 bucket binding
    if (!context.env.R2_BUCKET) {
      node.error('R2 bucket not configured. Add R2_BUCKET binding to wrangler.toml', msg);
      return null;
    }
    
    const filename = node.config.filename || msg.filename;
    
    if (!filename) {
      node.error('No filename specified', msg);
      return null;
    }
    
    try {
      if (node.config.action === 'write' || node.config.action === 'append') {
        let content = msg.payload;
        
        // Convert to string if needed
        if (typeof content !== 'string' && !(content instanceof Uint8Array)) {
          content = JSON.stringify(content);
        }
        
        if (node.config.action === 'append') {
          // Read existing content
          const existing = await context.env.R2_BUCKET.get(filename);
          const existingContent = existing ? await existing.text() : '';
          content = existingContent + content;
        }
        
        await context.env.R2_BUCKET.put(filename, content);
        msg.payload = { written: true, filename, size: content.length };
        
      } else if (node.config.action === 'delete') {
        await context.env.R2_BUCKET.delete(filename);
        msg.payload = { deleted: true, filename };
      }
      
      return msg;
      
    } catch (err: any) {
      node.error(`File operation failed: ${err.message}`, msg);
      return null;
    }
  }
});

registry.register('file in', {
  type: 'file in',
  category: 'storage',
  color: '#7CB9E8',
  defaults: {
    name: { value: '' },
    filename: { value: '' },
    filenameType: { value: 'str' },
    format: { value: 'utf8' }
  },
  inputs: 1,
  outputs: 1,
  icon: 'file.svg',
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    if (!context.env.R2_BUCKET) {
      node.error('R2 bucket not configured', msg);
      return null;
    }
    
    const filename = node.config.filename || msg.filename;
    
    if (!filename) {
      node.error('No filename specified', msg);
      return null;
    }
    
    try {
      const object = await context.env.R2_BUCKET.get(filename);
      
      if (!object) {
        node.error(`File not found: ${filename}`, msg);
        return null;
      }
      
      if (node.config.format === 'utf8') {
        msg.payload = await object.text();
      } else {
        msg.payload = new Uint8Array(await object.arrayBuffer());
      }
      
      msg.filename = filename;
      return msg;
      
    } catch (err: any) {
      node.error(`File read failed: ${err.message}`, msg);
      return null;
    }
  }
});

// ===================================================================
// EXTRA UTILITY NODES
// ===================================================================

registry.register('exec', {
  type: 'exec',
  category: 'advanced',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    command: { value: '' }
  },
  inputs: 1,
  outputs: 3,
  icon: 'exec.svg',
  execute: async (msg: NodeMessage, node: Node) => {
    // Not supported in Cloudflare Workers
    node.error('exec node is not supported in Cloudflare Workers environment', msg);
    return null;
  }
});

registry.register('unknown', {
  type: 'unknown',
  category: 'common',
  color: '#dddddd',
  defaults: {
    name: { value: '' }
  },
  inputs: 1,
  outputs: 1,
  execute: async (msg: NodeMessage, node: Node) => {
    node.warn('Unknown node type - passing message through');
    return msg;
  }
});

// ===================================================================
// Export node count for verification
// ===================================================================

export const REGISTERED_NODE_COUNT = registry.list().length;
console.log(`[RedNox] Registered ${REGISTERED_NODE_COUNT} standard nodes`);
