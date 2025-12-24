
// ===================================================================
// FlowExecutorDO - Ephemeral Flow Execution
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
    
    // Flow context (scoped to this DO instance)
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
    
    // Global context (shared across all DO instances via storage)
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
    
    // Internal/Admin endpoints
    if (url.pathname.startsWith('/internal/')) {
      return this.handleInternal(url.pathname, request);
    }
    
    // Flow execution (HTTP trigger)
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
      // 1. Load flow from D1 (no caching)
      const route = await this.lookupRoute(fullPath, method);
      
      if (!route) {
        return this.errorResponse('Route not found', 404, { 
          path: fullPath,
          method 
        });
      }
      
      // 2. Parse request
      const payload = await this.parseRequest(request, fullPath);
      const msg: NodeMessage = {
        _msgid: crypto.randomUUID(),
        payload,
        topic: ''
      };
      
      // 3. Create ephemeral execution context
      const context: ExecutionContext = {
        storage: this.state.storage,
        env: this.env,
        flow: this.flowContext,
        global: this.globalContext
      };
      
      // 4. Create fresh flow engine
      const engine = new FlowEngine(route.flowConfig, context);
      await engine.initialize();
      
      // 5. Execute flow
      const result = await engine.triggerFlow(route.nodeId, msg);
      const duration = Date.now() - startTime;
      
      // 6. Cleanup engine (ephemeral)
      await engine.close();
      
      // 7. Log execution (async, non-blocking)
      this.ctx.waitUntil(
        this.logExecution(route.flowId, route.nodeId, 'success', duration)
      );
      
      // 8. Return response
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
      // Set alarm for 1 minute from now
      await this.state.storage.setAlarm(Date.now() + 60000);
    }
  }
  
  async alarm() {
    const now = Date.now();
    
    // Find all schedules
    const schedules = await this.state.storage.list<InjectSchedule>({ 
      prefix: StorageKeys.listPrefix('sched:') 
    });
    
    for (const [key, schedule] of schedules) {
      if (!schedule || !schedule.repeat) continue;
      
      // Check if it's time to run
      if (schedule.nextRun && schedule.nextRun <= now) {
        try {
          // Load flow and execute inject node
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
          
          // Update next run time
          if (schedule.interval) {
            schedule.nextRun = now + schedule.interval;
            await this.state.storage.put(key, schedule);
          }
          
        } catch (err) {
          console.error(`[Scheduler] Error executing ${schedule.nodeId}:`, err);
        }
      }
    }
    
    // Set next alarm
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
    
    // Find first inject node
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
  // INTERNAL ENDPOINTS
  // ===================================================================
  
  private async handleInternal(pathname: string, request: Request): Promise<Response> {
    switch (pathname) {
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
        `).bind(flowId, nodeId, status, duration, errorMessage || null).run();
      }
    } catch (err) {
      console.error('[FlowExecutorDO] Failed to log:', err);
    }
  }
}
