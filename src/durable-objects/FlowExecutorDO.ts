
// ===================================================================
// RedNox - Flow Executor DO (Optimized for 30s CPU Budget)
// ===================================================================

import { DurableObject } from 'cloudflare:workers';
import { FlowEngine } from '../core/FlowEngine';
import { FlowConfig, FlowContext, GlobalContext, ExecutionContext, NodeMessage } from '../types/core';

export class FlowExecutorDO extends DurableObject {
  private flowEngine?: FlowEngine;
  private flowConfig?: FlowConfig;
  private flowContext: FlowContext;
  private globalContext: GlobalContext;
  private lastFlowId?: string;
  
  constructor(state: DurableObjectState, env: any) {
    super(state, env);
    
    // Lazy context initialization
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
  
  // RPC Method: Execute Flow with automatic loading
  // This is the main entry point - combines load + execute
  async executeFlow(
    flowConfig: FlowConfig,
    entryNodeId: string,
    payload: any
  ): Promise<{ 
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    duration: number;
  }> {
    const startTime = Date.now();
    
    try {
      // Smart caching: only reload if flow changed
      if (!this.flowEngine || this.lastFlowId !== flowConfig.id) {
        await this.loadFlowInternal(flowConfig);
        this.lastFlowId = flowConfig.id;
      }
      
      // Create message
      const msg: NodeMessage = {
        _msgid: crypto.randomUUID(),
        payload,
        topic: ''
      };
      
      // Execute flow (this can use full 30s if needed)
      const result = await this.flowEngine!.triggerFlow(entryNodeId, msg);
      const duration = Date.now() - startTime;
      
      // Log execution asynchronously (don't block response)
      this.ctx.waitUntil(
        this.logExecution(flowConfig.id, 'success', duration)
      );
      
      // Return HTTP response
      if (result?._httpResponse) {
        const resPayload = result._httpResponse.payload;
        return {
          statusCode: result._httpResponse.statusCode,
          headers: result._httpResponse.headers,
          body: typeof resPayload === 'string' ? resPayload : JSON.stringify(resPayload),
          duration
        };
      }
      
      // Default success response
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: true, 
          duration: duration + 'ms',
          flowId: flowConfig.id
        }),
        duration
      };
      
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error('[FlowExecutor] Error:', err);
      
      // Log error asynchronously
      this.ctx.waitUntil(
        this.logExecution(flowConfig.id, 'error', duration, err.message)
      );
      
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: err.message,
          duration: duration + 'ms'
        }),
        duration
      };
    }
  }
  
  // Internal flow loading (cached in DO memory)
  private async loadFlowInternal(flowConfig: FlowConfig): Promise<void> {
    const context: ExecutionContext = {
      storage: this.ctx.storage,
      env: this.env,
      flow: this.flowContext,
      global: this.globalContext
    };
    
    this.flowConfig = flowConfig;
    this.flowEngine = new FlowEngine(flowConfig, context);
    await this.flowEngine.initialize();
  }
  
  // Async logging (uses waitUntil to not block response)
  private async logExecution(
    flowId: string,
    status: string,
    duration: number,
    errorMessage?: string
  ): Promise<void> {
    try {
      await this.ctx.storage.put(`log:${Date.now()}`, {
        flowId,
        status,
        duration,
        errorMessage: errorMessage || null,
        timestamp: new Date().toISOString()
      });
      
      // Optionally clean old logs (keep last 100)
      const logs = await this.ctx.storage.list({ prefix: 'log:' });
      if (logs.size > 100) {
        const oldLogs = Array.from(logs.keys())
          .sort()
          .slice(0, logs.size - 100);
        await this.ctx.storage.delete(oldLogs);
      }
    } catch (err) {
      console.error('[FlowExecutor] Failed to log:', err);
    }
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
    uptime: number;
  }> {
    return {
      loaded: !!this.flowEngine,
      flowId: this.flowConfig?.id,
      flowName: this.flowConfig?.name,
      nodeCount: this.flowConfig?.nodes.length || 0,
      uptime: Date.now() // Could track actual uptime if needed
    };
  }
  
  // RPC Method: Clear cache (force reload)
  async clearCache(): Promise<{ success: boolean }> {
    this.flowEngine = undefined;
    this.flowConfig = undefined;
    this.lastFlowId = undefined;
    return { success: true };
  }
  
  // Alarm handler for scheduled flows (future enhancement)
  async alarm(): Promise<void> {
    // Handle scheduled/cron triggers
    console.log('[FlowExecutor] Alarm triggered');
  }
}
