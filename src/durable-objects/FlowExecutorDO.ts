
// ===================================================================
// FlowExecutorDO.ts - Handles EVERYTHING (Route Lookup + Execution)
// ===================================================================

import { DurableObject } from 'cloudflare:workers';
import { FlowEngine } from '../core/FlowEngine';
import { FlowConfig, FlowContext, GlobalContext, ExecutionContext, NodeMessage, Env } from '../types/core';

export class FlowExecutorDO extends DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private flowEngine?: FlowEngine;
  private flowConfig?: FlowConfig;
  private flowContext: FlowContext;
  private globalContext: GlobalContext;
  private lastFlowId?: string;
  
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    
    this.flowContext = {
      get: async (key: string) => await this.state.storage.get(`flow:${key}`),
      set: async (key: string, value: any) => 
        await this.state.storage.put(`flow:${key}`, value),
      keys: async () => {
        const list = await this.state.storage.list({ prefix: 'flow:' });
        return Array.from(list.keys()).map(k => k.replace('flow:', ''));
      }
    };
    
    this.globalContext = {
      get: async (key: string) => await this.state.storage.get(`global:${key}`),
      set: async (key: string, value: any) => 
        await this.state.storage.put(`global:${key}`, value),
      keys: async () => {
        const list = await this.state.storage.list({ prefix: 'global:' });
        return Array.from(list.keys()).map(k => k.replace('global:', ''));
      }
    };
  }
  
  // ===================================================================
  // MAIN ENTRY POINT: Handle HTTP Request Directly
  // ===================================================================
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api', ''); // Remove /api prefix
    const method = request.method.toUpperCase();
    const startTime = Date.now();
    
    try {
      // 1. Route Lookup (happens in DO, not worker)
      const route = await this.lookupRoute(path, method);
      
      if (!route) {
        return new Response(JSON.stringify({ 
          error: 'Route not found',
          path,
          method 
        }), { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // 2. Parse request payload
      const payload = await this.parseRequestPayload(request, path);
      
      // 3. Load flow if needed (with caching)
      if (!this.flowEngine || this.lastFlowId !== route.flowId) {
        await this.loadFlow(route.flowConfig);
        this.lastFlowId = route.flowId;
      }
      
      // 4. Create message
      const msg: NodeMessage = {
        _msgid: crypto.randomUUID(),
        payload,
        topic: ''
      };
      
      // 5. Execute flow (can use full 30s)
      const result = await this.flowEngine!.triggerFlow(route.nodeId, msg);
      const duration = Date.now() - startTime;
      
      // 6. Log execution asynchronously
      this.state.blockConcurrencyWhile(async () => 
        await this.logExecution(route.flowId, 'success', duration)
      );
      
      // 7. Return HTTP response
      if (result?._httpResponse) {
        const resPayload = result._httpResponse.payload;
        return new Response(
          typeof resPayload === 'string' ? resPayload : JSON.stringify(resPayload),
          {
            status: result._httpResponse.statusCode,
            headers: {
              ...result._httpResponse.headers,
              'X-Execution-Time': duration + 'ms'
            }
          }
        );
      }
      
      // Default success response
      return new Response(JSON.stringify({ 
        success: true, 
        duration: duration + 'ms',
        flowId: route.flowId
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error('[FlowExecutorDO] Error:', err);
      
      return new Response(JSON.stringify({ 
        error: err.message,
        stack: err.stack,
        duration: duration + 'ms'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  // ===================================================================
  // Route Lookup (uses DO's env.DB access)
  // ===================================================================
  private async lookupRoute(path: string, method: string): Promise<{
    flowId: string;
    nodeId: string;
    flowConfig: FlowConfig;
  } | null> {
    if (!this.env.DB) {
      throw new Error('Database not configured');
    }
    
    const route = await this.env.DB.prepare(`
      SELECT r.flow_id, r.node_id, f.config 
      FROM http_routes r
      JOIN flows f ON f.id = r.flow_id
      WHERE r.path = ? AND r.method = ? AND r.enabled = 1 AND f.enabled = 1
      LIMIT 1
    `).bind(path, method).first();
    
    if (!route) {
      return null;
    }
    
    return {
      flowId: route.flow_id as string,
      nodeId: route.node_id as string,
      flowConfig: JSON.parse(route.config as string)
    };
  }
  
  // ===================================================================
  // Parse Request Payload
  // ===================================================================
  private async parseRequestPayload(request: Request, path: string): Promise<any> {
    const url = new URL(request.url);
    const contentType = request.headers.get('content-type') || '';
    
    let body: any = null;
    
    // Parse body based on content-type
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (contentType.includes('application/json')) {
        try {
          body = await request.json();
        } catch {
          body = null;
        }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await request.formData();
        body = Object.fromEntries(formData);
      } else if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        body = Object.fromEntries(formData);
      } else {
        body = await request.text();
      }
    }
    
    // Build payload matching Node-RED's http-in format
    return {
      body,
      headers: Object.fromEntries(request.headers),
      query: Object.fromEntries(url.searchParams),
      params: {}, // Could extract route params if needed
      method: request.method,
      url: request.url,
      path
    };
  }
  
  // ===================================================================
  // Load Flow (cached in DO memory)
  // ===================================================================
  private async loadFlow(flowConfig: FlowConfig): Promise<void> {
    const context: ExecutionContext = {
      storage: this.state.storage,
      env: this.env,
      flow: this.flowContext,
      global: this.globalContext
    };
    
    this.flowConfig = flowConfig;
    this.flowEngine = new FlowEngine(flowConfig, context);
    await this.flowEngine.initialize();
  }
  
  // ===================================================================
  // Async Logging
  // ===================================================================
  private async logExecution(
    flowId: string,
    status: string,
    duration: number,
    errorMessage?: string
  ): Promise<void> {
    try {
      await this.state.storage.put(`log:${Date.now()}`, {
        flowId,
        status,
        duration,
        errorMessage: errorMessage || null,
        timestamp: new Date().toISOString()
      });
      
      // Clean old logs (keep last 100)
      const logs = await this.state.storage.list({ prefix: 'log:' });
      if (logs.size > 100) {
        const oldLogs = Array.from(logs.keys())
          .sort()
          .slice(0, logs.size - 100);
        await this.state.storage.delete(oldLogs);
      }
    } catch (err) {
      console.error('[FlowExecutorDO] Failed to log:', err);
    }
  }
  
  // ===================================================================
  // Admin RPC Methods (still accessible via RPC if needed)
  // ===================================================================
  async getDebugMessages(): Promise<any[]> {
    const allDebug = await this.state.storage.list({ prefix: 'debug:' });
    const messages: any[] = [];
    
    for (const [key, value] of allDebug.entries()) {
      messages.push({ key, ...value });
    }
    
    messages.sort((a, b) => b.timestamp - a.timestamp);
    return messages.slice(0, 100);
  }
  
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
      nodeCount: this.flowConfig?.nodes?.length || 0
    };
  }
  
  async clearCache(): Promise<{ success: boolean }> {
    this.flowEngine = undefined;
    this.flowConfig = undefined;
    this.lastFlowId = undefined;
    return { success: true };
  }
  
  async alarm(): Promise<void> {
    console.log('[FlowExecutorDO] Alarm triggered');
  }
}
