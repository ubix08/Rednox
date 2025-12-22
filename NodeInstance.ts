// src/nodes/NodeInstance.ts
import { Node, NodeStatus, NodeMessage, NodeContext, ExecutionContext, NodeConfig } from '../types/core';
import { RED } from '../utils/red';

export class NodeInstance implements Node {
  id: string;
  type: string;
  name?: string;
  config: NodeConfig;
  
  private _status: NodeStatus | null = null;
  private _context: NodeContext;
  private _executionContext: ExecutionContext;
  private _eventHandlers = new Map<string, Function[]>();
  
  constructor(config: NodeConfig, context: ExecutionContext) {
    this.id = config.id;
    this.type = config.type;
    this.name = config.name;
    this.config = config;
    this._executionContext = context;
    
    this._context = {
      flow: context.flow,
      global: context.global,
      get: async (key: string) => context.storage.get(`node:${this.id}:${key}`),
      set: async (key: string, value: any) => await context.storage.put(`node:${this.id}:${key}`, value),
      keys: async () => {
        const list = await context.storage.list({ prefix: `node:${this.id}:` });
        return Array.from(list.keys()).map(k => k.replace(`node:${this.id}:`, ''));
      }
    };
  }
  
  send(msg: NodeMessage | NodeMessage[] | NodeMessage[][]) {
    if (this._executionContext.flowEngine) {
      this._executionContext.flowEngine.routeMessage(this, msg);
    }
  }
  
  status(status: NodeStatus) {
    this._status = status;
  }
  
  error(err: string | Error, msg?: NodeMessage) {
    const errorMsg = err instanceof Error ? err.message : err;
    console.error(`[${this.type}:${this.id}] ERROR:`, errorMsg);
    if (this._executionContext.flowEngine) {
      this._executionContext.flowEngine.handleNodeError(
        err instanceof Error ? err : new Error(errorMsg),
        this,
        msg
      );
    }
  }
  
  warn(warning: string) {
    console.warn(`[${this.type}:${this.id}] WARN:`, warning);
  }
  
  log(msg: string) {
    console.log(`[${this.type}:${this.id}]`, msg);
  }
  
  context(): NodeContext {
    return this._context;
  }
  
  on(event: string, callback: Function) {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, []);
    }
    this._eventHandlers.get(event)!.push(callback);
  }
  
  once(event: string, callback: Function) {
    const wrapper = (...args: any[]) => {
      callback(...args);
      this.removeListener(event, wrapper);
    };
    this.on(event, wrapper);
  }
  
  removeListener(event: string, callback: Function) {
    const handlers = this._eventHandlers.get(event);
    if (handlers) {
      const idx = handlers.indexOf(callback);
      if (idx !== -1) handlers.splice(idx, 1);
    }
  }
  
  emit(event: string, ...args: any[]) {
    const handlers = this._eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler.apply(this, args);
        } catch (err) {
          console.error(`Event handler error [${event}]:`, err);
        }
      });
    }
  }
  
  done() {}
}