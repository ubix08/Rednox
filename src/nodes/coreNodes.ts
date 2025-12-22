// src/nodes/coreNodes.ts
import { registry } from './NodeRegistry';
import { RuntimeNodeDefinition } from '../types/core';
import { NodeMessage, Node, ExecutionContext } from '../types/core';
import { RED } from '../utils/red';
import { evaluateProperty } from '../utils/evaluateProperty';

registry.register('http-in', {
  type: 'http-in',
  category: 'input',
  color: '#e7e7ae',
  defaults: { method: { value: 'get' }, url: { value: '/' }, name: { value: '' } },
  inputs: 0,
  outputs: 1,
  icon: 'white-globe.svg',
  execute: async (msg: NodeMessage) => msg
} as RuntimeNodeDefinition);

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
} as RuntimeNodeDefinition);

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
      const func = new AsyncFunction('msg', 'node', 'context', 'flow', 'global', node.config.func);
      const result = await func(msg, node, node.context(), node.context().flow, node.context().global);
      return result === undefined || result === null ? null : result;
    } catch (error: any) {
      node.error(error, msg);
      return null;
    }
  }
} as RuntimeNodeDefinition);

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
} as RuntimeNodeDefinition);

registry.register('debug', {
  type: 'debug',
  category: 'output',
  color: '#87a980',
  defaults: { name: { value: '' }, active: { value: true }, complete: { value: 'payload' } },
  inputs: 1,
  outputs: 0,
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    if (!node.config.active) return null;
    const output = node.config.complete === 'true' ? msg : RED.util.getMessageProperty(msg, node.config.complete);
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
} as RuntimeNodeDefinition);

registry.register('http-request', {
  type: 'http-request',
  category: 'function',
  color: '#e7e7ae',
  defaults: { name: { value: '' }, method: { value: 'GET' }, url: { value: '' }, ret: { value: 'txt' } },
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
        case 'obj': msg.payload = await response.json(); break;
        case 'bin': msg.payload = await response.arrayBuffer(); break;
        default: msg.payload = await response.text();
      }
      
      return msg;
    } catch (err: any) {
      node.error(err.message, msg);
      return null;
    }
  }
} as RuntimeNodeDefinition);

registry.register('template', {
  type: 'template',
  category: 'function',
  color: '#fdd0a2',
  defaults: { name: { value: '' }, field: { value: 'payload' }, template: { value: '' }, output: { value: 'str' } },
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
} as RuntimeNodeDefinition);

registry.register('json', {
  type: 'json',
  category: 'function',
  color: '#fdd0a2',
  defaults: { name: { value: '' }, property: { value: 'payload' }, action: { value: '' } },
  inputs: 1,
  outputs: 1,
  execute: async (msg: NodeMessage, node: Node) => {
    const prop = node.config.property || 'payload';
    const value = RED.util.getMessageProperty(msg, prop);
    
    try {
      if (node.config.action === 'str' || (node.config.action === '' && typeof value === 'object')) {
        RED.util.setMessageProperty(msg, prop, JSON.stringify(value));
      } else if (node.config.action === 'obj' || (node.config.action === '' && typeof value === 'string')) {
        RED.util.setMessageProperty(msg, prop, JSON.parse(value));
      }
    } catch (err: any) {
      node.error('JSON conversion failed: ' + err.message, msg);
      return null;
    }
    
    return msg;
  }
} as RuntimeNodeDefinition);

// src/engine/FlowEngine.ts
import { NodeInstance } from '../nodes/NodeInstance';
import { FlowConfig, ExecutionContext, NodeMessage } from '../types/core';
import { registry } from '../nodes/NodeRegistry';
import { RED } from '../utils/red';

export class FlowEngine {
  private nodes = new Map<string, NodeInstance>();
  private flowConfig: FlowConfig;
  private context: ExecutionContext;
  private httpResponse: NodeMessage | null = null;
  
  constructor(flowConfig: FlowConfig, context: ExecutionContext) {
    this.flowConfig = flowConfig;
    this.context = context;
    this.context.flowEngine = this;
  }
  
  async initialize() {
    this.nodes.clear();
    
    for (const nodeConfig of this.flowConfig.nodes || []) {
      const definition = registry.get(nodeConfig.type);
      if (!definition) continue;
      
      const nodeInstance = new NodeInstance(nodeConfig, this.context);
      this.nodes.set(nodeConfig.id, nodeInstance);
      
      if (definition.onInit) {
        await definition.onInit(nodeInstance, this.context);
      }
    }
  }
  
  async executeNode(nodeId: string, msg: NodeMessage): Promise<NodeMessage | NodeMessage[] | NodeMessage[][] | null> {
    const nodeInstance = this.nodes.get(nodeId);
    if (!nodeInstance) return null;
    
    const definition = registry.get(nodeInstance.type);
    if (!definition) return null;
    
    try {
      const result = await definition.execute(msg, nodeInstance, this.context);
      
      if (result && (result as NodeMessage)._httpResponse) {
        this.httpResponse = result as NodeMessage;
      }
      
      if (result) {
        await this.routeMessage(nodeInstance, result);
      }
      
      return result;
    } catch (err: any) {
      await this.handleNodeError(err, nodeInstance, msg);
      return null;
    }
  }
  
  async routeMessage(sourceNode: NodeInstance, msg: NodeMessage | NodeMessage[] | NodeMessage[][]) {
    const wires = sourceNode.config.wires;
    if (!wires || wires.length === 0) return;
    
    if (Array.isArray(msg)) {
      const promises: Promise<any>[] = [];
      for (let outputIdx = 0; outputIdx < msg.length; outputIdx++) {
        const outputMsg = msg[outputIdx];
        const targetWires = wires[outputIdx] || [];
        
        if (outputMsg === null || outputMsg === undefined) continue;
        
        if (Array.isArray(outputMsg)) {
          for (const singleMsg of outputMsg) {
            if (singleMsg) {
              for (const targetNodeId of targetWires) {
                promises.push(this.executeNode(targetNodeId, RED.util.cloneMessage(singleMsg)));
              }
            }
          }
        } else {
          for (const targetNodeId of targetWires) {
            promises.push(this.executeNode(targetNodeId, RED.util.cloneMessage(outputMsg)));
          }
        }
      }
      await Promise.all(promises);
    } else {
      const targetWires = wires[0] || [];
      await Promise.all(targetWires.map(nodeId => 
        this.executeNode(nodeId, RED.util.cloneMessage(msg))
      ));
    }
  }
  
  async handleNodeError(error: Error, sourceNode: NodeInstance, msg?: NodeMessage) {
    console.error(`Node error [${sourceNode.id}]:`, error);
  }
  
  async triggerFlow(entryNodeId: string, initialMsg?: NodeMessage): Promise<NodeMessage | null> {
    this.httpResponse = null;
    const msg = initialMsg || { _msgid: crypto.randomUUID(), payload: {}, topic: '' };
    await this.executeNode(entryNodeId, msg);
    return this.httpResponse;
  }
}
