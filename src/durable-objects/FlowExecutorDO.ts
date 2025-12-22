// ===================================================================
// RedNox - Durable Object with RPC - Flow Executor
// ===================================================================

import { DurableObject } from 'cloudflare:workers';
import { FlowEngine } from '../core/FlowEngine';
import { FlowConfig, FlowContext, GlobalContext, ExecutionContext, NodeMessage } from '../types/core';

export class FlowExecutorDO extends DurableObject {
  private flowEngine?: FlowEngine;
  private flowConfig?: FlowConfig;
  private flowContext: FlowContext;
  private globalContext: GlobalContext;
  
  constructor(state: DurableObjectState, env: any) {
    super(state, env);
    
    this.flowContext = {
      get: async (key: string) => this.ctx.storage.get(`flow:${key}`),
      set: async (key: string, value: any) => 
        await this.ctx.storage.put(`flow:${key}`, value),
      keys: async () => {
        const list = await this.ctx.storage.list({ prefix: 'flow:' });
        return Array.from(list.keys()).map(k => k.replace('flow:', ''));
      }
    };
    
    this.globalContext = {
      get: async (key: string) => this.ctx.storage.get(`global:${key}`),
      set: async (key: string, value: any) => 
        await this.ctx.storage.put(`global:${key}`, value),
      keys: async () => {
        const list = await this.ctx.storage.list({ prefix: 'global:' });
        return Array.from(list.keys()).map(k => k.replace('global:', ''));
      }
    };
  }
  
  // RPC Method: Load Flow Configuration
  async loadFlow(flowConfig: FlowConfig): Promise<{ success: boolean; nodeCount: number }> {
    this.flowConfig = flowConfig;
    
    const context: ExecutionContext = {
      storage: this.ctx.storage,
      env: this.env,
      flow: this.flowContext,
      global: this.globalContext
    };
    
    this.flowEngine = new FlowEngine(flowConfig, context);
    await this.flowEngine.initialize();
    
    return { success: true, nodeCount: flowConfig.nodes.length };
  }
  
  // RPC Method: Execute Flow
  async executeFlow(entryNodeId: string, payload: any): Promise<{ 
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    duration: number;
  }> {
    if (!this.flowEngine) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Flow not loaded' }),
        duration: 0
      };
    }
    
    const msg: NodeMessage = {
      _msgid: crypto.randomUUID(),
      payload,
      topic: ''
    };
    
    const startTime = Date.now();
    const result = await this.flowEngine.triggerFlow(entryNodeId, msg);
    const duration = Date.now() - startTime;
    
    if (result?._httpResponse) {
      const resPayload = result._httpResponse.payload;
      return {
        statusCode: result._httpResponse.statusCode,
        headers: result._httpResponse.headers,
        body: typeof resPayload === 'string' ? resPayload : JSON.stringify(resPayload),
        duration
      };
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, duration: duration + 'ms' }),
      duration
    };
  }
  
  // RPC Method: Get Debug Messages
  async getDebugMessages(): Promise<any[]> {
    const allDebug = await this.ctx.storage.list({ prefix: 'debug:' });
    const messages: any[] = [];
    
    for (const [key, value] of allDebug.entries()) {
      messages.push({ key, ...value });
    }
    
    messages.sort((a, b) => b.timestamp - a.timestamp);
    return messages.slice(0, 100);
  }
  
  // RPC Method: Get Flow Status
  async getStatus(): Promise<{
    loaded: boolean;
    flowId?: string;
    flowName?: string;
    nodeCount: number;
  }> {
    return {
      loaded: !!this.flowEngine,
      flowId: this.flowConfig?.id,
      flowName: this.flowConfig?.name,
      nodeCount: this.flowConfig?.nodes.length || 0
    };
  }
}
