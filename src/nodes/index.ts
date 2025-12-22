// ===================================================================
// RedNox - Core Node Implementations
// ===================================================================

import { registry } from '../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext } from '../types/core';
import { RED, evaluateProperty } from '../utils';

// HTTP Input Node
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

// HTTP Response Node
registry.register('http-response', {
  type: 'http-response',
  category: 'output',
  color: '#e7e7ae',
  defaults: { name: { value: '' }, statusCode: { value: '' } },
  inputs: 1,
  outputs: 0,
  execute: async (msg: NodeMessage, node: Node) => {
    msg._httpResponse = {
      statusCode: node.config.statusCode || msg.statusCode || 200,
      headers: { 'Content-Type': 'application/json', ...msg.headers },
      payload: msg.payload
    };
    return null;
  }
});

// Function Node
registry.register('function', {
  type: 'function',
  category: 'function',
  color: '#fdd0a2',
  defaults: { name: { value: '' }, func: { value: 'return msg;' }, outputs: { value: 1 } },
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
        node.config.func
      );
      const result = await func(
        msg,
        node,
        node.context(),
        node.context().flow,
        node.context().global
      );
      return result === undefined || result === null ? null : result;
    } catch (error: any) {
      node.error(error, msg);
      return null;
    }
  }
});

// Change Node
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
        }
      } catch (err) {
        node.error('Rule execution failed: ' + err, msg);
      }
    }
    return msg;
  }
});

// Debug Node
registry.register('debug', {
  type: 'debug',
  category: 'output',
  color: '#87a980',
  defaults: { name: { value: '' }, active: { value: true }, complete: { value: 'payload' } },
  inputs: 1,
  outputs: 0,
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    if (!node.config.active) return null;
    const output = node.config.complete === 'true' 
      ? msg 
      : RED.util.getMessageProperty(msg, node.config.complete);
    console.log(`[DEBUG ${node.name || node.id}]`, output);
    
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

// HTTP Request Node
registry.register('http-request', {
  type: 'http-request',
  category: 'function',
  color: '#e7e7ae',
  defaults: {
    name: { value: '' },
    method: { value: 'GET' },
    url: { value: '' },
    ret: { value: 'txt' }
  },
  inputs: 1,
  outputs: 1,
  execute: async (msg: NodeMessage, node: Node) => {
    const url = node.config.url || msg.url;
    const method = (node.config.method || msg.method || 'GET').toUpperCase();
    
    if (!url) {
      node.error('No URL specified', msg);
      return null;
    }
    
    try {
      const headers: Record<string, string> = { ...msg.headers } || {};
      const options: RequestInit = { method, headers };
      
      if (msg.payload && ['POST', 'PUT', 'PATCH'].includes(method)) {
        if (typeof msg.payload === 'string') {
          options.body = msg.payload;
        } else {
          options.body = JSON.stringify(msg.payload);
          if (!headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
          }
        }
      }
      
      const response = await fetch(url, options);
      msg.statusCode = response.status;
      msg.headers = Object.fromEntries(response.headers);
      
      switch (node.config.ret) {
        case 'obj':
          msg.payload = await response.json();
          break;
        case 'bin':
          msg.payload = await response.arrayBuffer();
          break;
        default:
          msg.payload = await response.text();
      }
      
      return msg;
    } catch (err: any) {
      node.error(err.message, msg);
      return null;
    }
  }
});

// Template Node
registry.register('template', {
  type: 'template',
  category: 'function',
  color: '#fdd0a2',
  defaults: {
    name: { value: '' },
    field: { value: 'payload' },
    template: { value: '' },
    output: { value: 'str' }
  },
  inputs: 1,
  outputs: 1,
  execute: async (msg: NodeMessage, node: Node) => {
    let output = node.config.template || '';
    output = output.replace(/\{\{([^}]+)\}\}/g, (match: string, prop: string) => {
      const value = RED.util.getMessageProperty(msg, prop.trim());
      return value !== undefined ? String(value) : '';
    });
    
    if (node.config.output === 'json') {
      try {
        output = JSON.parse(output);
      } catch (err) {
        node.error('Template produced invalid JSON', msg);
      }
    }
    
    RED.util.setMessageProperty(msg, node.config.field, output);
    return msg;
  }
});

// JSON Node
registry.register('json', {
  type: 'json',
  category: 'function',
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
