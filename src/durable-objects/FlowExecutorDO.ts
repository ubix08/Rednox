
// FlowExecutorDO.ts
// ===================================================================
// FlowExecutorDO - Ephemeral Flow Execution (FIXED)
// ===================================================================

import { DurableObject } from 'cloudflare:workers';
import { FlowEngine } from '../core/FlowEngine';
import { 
  FlowConfig, FlowContext, GlobalContext, ExecutionContext, 
  NodeMessage, Env, RouteInfo, InjectSchedule
} from '../types/core';
import { StorageKeys } from '../utils';

export class FlowExecutorDO extends DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private flowContext: FlowContext;
  private globalContext: GlobalContext;
  
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    
    this.flowContext = {
      get: async (key: string) => 
        await this.state.storage.get(StorageKeys.flow(key)),
      set: async (key: string, value: any) => 
        await this.state.storage.put(StorageKeys.flow(key), value),
      keys: async () => {
        const list = await this.state.storage.list({ 
          prefix: StorageKeys.listPrefix('f:') 
        });
        return Array.from(list.keys()).map(k => k.replace('f:', ''));
      }
    };
    
    this.globalContext = {
      get: async (key: string) => 
        await this.state.storage.get(StorageKeys.global(key)),
      set: async (key: string, value: any) => 
        await this.state.storage.put(StorageKeys.global(key), value),
      keys: async () => {
        const list = await this.state.storage.list({ 
          prefix: StorageKeys.listPrefix('g:') 
        });
        return Array.from(list.keys()).map(k => k.replace('g:', ''));
      }
    };
    
    this.setupScheduler();
  }
  
  // ===================================================================
  // MAIN ENTRY POINT
  // ===================================================================
  
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname.startsWith('/internal/')) {
      return this.handleInternal(url.pathname, request);
    }
    
    return this.handleFlowExecution(request);
  }
  
  // ===================================================================
  // EPHEMERAL FLOW EXECUTION
  // ===================================================================
  
  private async handleFlowExecution(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const fullPath = url.pathname.replace('/api', '');
    const method = request.method.toUpperCase();
    const startTime = Date.now();
    
    try {
      const route = await this.lookupRoute(fullPath, method);
      
      if (!route) {
        return this.errorResponse('Route not found', 404, { 
          path: fullPath,
          method 
        });
      }
      
      const payload = await this.parseRequest(request, fullPath);
      const msg: NodeMessage = {
        _msgid: crypto.randomUUID(),
        payload,
        topic: ''
      };
      
      const context: ExecutionContext = {
        storage: this.state.storage,
        env: this.env,
        flow: this.flowContext,
        global: this.globalContext
      };
      
      const engine = new FlowEngine(route.flowConfig, context);
      await engine.initialize();
      
      const result = await engine.triggerFlow(route.nodeId, msg);
      const duration = Date.now() - startTime;
      
      await engine.close();
      
      this.ctx.waitUntil(
        this.logExecution(route.flowId, route.nodeId, 'success', duration)
      );
      
      return this.formatResponse(result, duration, route.flowId);
      
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error('[FlowExecutorDO] Error:', err);
      
      return this.errorResponse(err.message, 500, { 
        duration,
        stack: err.stack
      });
    }
  }
  
  // ===================================================================
  // SCHEDULED EXECUTION (Inject Nodes)
  // ===================================================================
  
  private async setupScheduler() {
    const currentAlarm = await this.state.storage.getAlarm();
    if (!currentAlarm) {
      await this.state.storage.setAlarm(Date.now() + 60000);
    }
  }
  
  async alarm() {
    const now = Date.now();
    
    const schedules = await this.state.storage.list<InjectSchedule>({ 
      prefix: StorageKeys.listPrefix('sched:') 
    });
    
    for (const [key, schedule] of schedules) {
      if (!schedule || !schedule.repeat) continue;
      
      if (schedule.nextRun && schedule.nextRun <= now) {
        try {
          const route = await this.lookupFlowById(schedule.flowId);
          
          if (route) {
            const context: ExecutionContext = {
              storage: this.state.storage,
              env: this.env,
              flow: this.flowContext,
              global: this.globalContext
            };
            
            const engine = new FlowEngine(route.flowConfig, context);
            await engine.initialize();
            
            const msg: NodeMessage = {
              _msgid: crypto.randomUUID(),
              payload: Date.now(),
              topic: 'scheduled'
            };
            
            await engine.triggerFlow(schedule.nodeId, msg);
            await engine.close();
            
            console.log(`[Scheduler] Executed inject node ${schedule.nodeId}`);
          }
          
          if (schedule.interval) {
            schedule.nextRun = now + schedule.interval;
            await this.state.storage.put(key, schedule);
          }
          
        } catch (err) {
          console.error(`[Scheduler] Error executing ${schedule.nodeId}:`, err);
        }
      }
    }
    
    await this.state.storage.setAlarm(Date.now() + 60000);
  }
  
  // ===================================================================
  // ROUTE LOOKUP
  // ===================================================================
  
  private async lookupRoute(fullPath: string, method: string): Promise<RouteInfo | null> {
    if (!this.env.DB) {
      throw new Error('Database not configured');
    }
    
    const route = await this.env.DB.prepare(`
      SELECT r.flow_id, r.node_id, f.config 
      FROM http_routes r
      JOIN flows f ON f.id = r.flow_id
      WHERE r.path = ? AND r.method = ? AND r.enabled = 1 AND f.enabled = 1
      LIMIT 1
    `).bind(fullPath, method).first();
    
    if (!route) {
      return null;
    }
    
    return {
      flowId: route.flow_id as string,
      nodeId: route.node_id as string,
      flowConfig: JSON.parse(route.config as string)
    };
  }
  
  private async lookupFlowById(flowId: string): Promise<RouteInfo | null> {
    if (!this.env.DB) {
      throw new Error('Database not configured');
    }
    
    const flow = await this.env.DB.prepare(
      'SELECT config FROM flows WHERE id = ? AND enabled = 1'
    ).bind(flowId).first();
    
    if (!flow) {
      return null;
    }
    
    const flowConfig: FlowConfig = JSON.parse(flow.config as string);
    
    const injectNode = flowConfig.nodes.find(n => n.type === 'inject');
    
    if (!injectNode) {
      return null;
    }
    
    return {
      flowId,
      nodeId: injectNode.id,
      flowConfig
    };
  }
  
  // ===================================================================
  // REQUEST PARSING
  // ===================================================================
  
  private async parseRequest(request: Request, path: string): Promise<any> {
    const url = new URL(request.url);
    const contentType = request.headers.get('content-type') || '';
    
    let body: any = null;
    
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        if (contentType.includes('application/json')) {
          body = await request.json();
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          const formData = await request.formData();
          body = Object.fromEntries(formData);
        } else {
          body = await request.text();
        }
      } catch (err) {
        body = null;
      }
    }
    
    return {
      body,
      headers: Object.fromEntries(request.headers),
      query: Object.fromEntries(url.searchParams),
      method: request.method,
      url: request.url,
      path
    };
  }
  
  // ===================================================================
  // RESPONSE FORMATTING
  // ===================================================================
  
  private formatResponse(result: any, duration: number, flowId: string): Response {
    if (result?._httpResponse) {
      const resPayload = result._httpResponse.payload;
      const body = typeof resPayload === 'string' ? resPayload : JSON.stringify(resPayload);
      
      return new Response(body, {
        status: result._httpResponse.statusCode,
        headers: {
          ...result._httpResponse.headers,
          'X-Execution-Time': duration + 'ms',
          'X-Flow-ID': flowId,
          'X-Message-ID': result._msgid
        }
      });
    }
    
    return this.jsonResponse({ 
      success: true, 
      duration: duration + 'ms',
      flowId
    });
  }
  
  private errorResponse(message: string, status: number, extra?: any): Response {
    return this.jsonResponse({ 
      error: message,
      ...extra
    }, status);
  }
  
  private jsonResponse(data: any, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // ===================================================================
  // FIXED: INTERNAL ENDPOINTS - Added /internal/execute
  // ===================================================================
  
  private async handleInternal(pathname: string, request: Request): Promise<Response> {
    switch (pathname) {
      case '/internal/execute':
        return await this.handleManualExecution(request);
        
      case '/internal/status':
        return this.jsonResponse({
          doId: this.state.id.toString(),
          ready: true,
          timestamp: new Date().toISOString()
        });
        
      case '/internal/context':
        const flowKeys = await this.flowContext.keys();
        const globalKeys = await this.globalContext.keys();
        return this.jsonResponse({
          flow: flowKeys,
          global: globalKeys
        });
        
      case '/internal/clear':
        await this.state.storage.deleteAll();
        return this.jsonResponse({ success: true, message: 'Storage cleared' });
        
      default:
        return this.errorResponse('Unknown internal endpoint', 404);
    }
  }
  
  // ===================================================================
  // FIXED: Manual Execution Handler
  // ===================================================================
  
  private async handleManualExecution(request: Request): Promise<Response> {
    try {
      const body = await request.json();
      const { nodeId, payload } = body;
      
      if (!nodeId) {
        return this.errorResponse('nodeId is required', 400);
      }
      
      // Extract flowId from DO name
      const flowId = this.state.id.toString().replace('flow:', '');
      
      // Load flow configuration
      const route = await this.lookupFlowById(flowId);
      
      if (!route) {
        return this.errorResponse('Flow not found', 404);
      }
      
      // Create execution context
      const context: ExecutionContext = {
        storage: this.state.storage,
        env: this.env,
        flow: this.flowContext,
        global: this.globalContext
      };
      
      // Create and initialize engine
      const engine = new FlowEngine(route.flowConfig, context);
      await engine.initialize();
      
      // Create message
      const msg: NodeMessage = {
        _msgid: crypto.randomUUID(),
        payload: payload || { test: true, manual: true },
        topic: 'manual-execution'
      };
      
      // Execute flow
      const startTime = Date.now();
      const result = await engine.triggerFlow(nodeId, msg);
      const duration = Date.now() - startTime;
      
      // Cleanup
      await engine.close();
      
      // Log execution
      await this.logExecution(flowId, nodeId, 'success', duration);
      
      return this.jsonResponse({
        success: true,
        result: result,
        duration: duration + 'ms',
        executionTime: new Date().toISOString()
      });
      
    } catch (err: any) {
      console.error('[Manual Execution] Error:', err);
      return this.errorResponse(err.message, 500, {
        stack: err.stack
      });
    }
  }
  
  // ===================================================================
  // LOGGING
  // ===================================================================
  
  private async logExecution(
    flowId: string,
    nodeId: string,
    status: string,
    duration: number,
    errorMessage?: string
  ): Promise<void> {
    try {
      if (this.env.DB) {
        await this.env.DB.prepare(`
          INSERT INTO flow_logs (flow_id, node_id, status, duration_ms, error_message)
          VALUES (?, ?, ?, ?, ?)
        `).bind(flowId, node_id, status, duration, errorMessage || null).run();
      }
    } catch (err) {
      console.error('[FlowExecutorDO] Failed to log:', err);
    }
  }
}
