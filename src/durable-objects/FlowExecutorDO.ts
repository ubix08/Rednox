// FlowExecutorDO.ts
// ===================================================================
// FlowExecutorDO - With D1 Persistent Context
// ===================================================================

import { DurableObject } from 'cloudflare:workers';
import { FlowEngine } from '../core/FlowEngine';
import { 
  FlowConfig, FlowContext, GlobalContext, ExecutionContext, 
  NodeMessage, Env, RouteInfo, InjectSchedule
} from '../types/core';
import { StorageKeys } from '../utils';
import { 
  PersistentFlowContext, 
  PersistentGlobalContext, 
  ExecutionContextManager,
  PersistentContextConfig 
} from '../core/PersistentContext';

export class FlowExecutorDO extends DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private flowId: string;
  private flowContext: PersistentFlowContext;
  private globalContext: PersistentGlobalContext;
  private contextManager: ExecutionContextManager;
  private contextConfig: PersistentContextConfig;
  
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    
    // Extract flowId from DO name
    this.flowId = this.state.id.name?.replace('flow:', '') || 'unknown';
    
    // Context configuration
    this.contextConfig = {
      maxExecutionsPerFlow: 100,
      maxContextsPerConversation: 20,
      cleanupOnWrite: true
    };
    
    // Initialize persistent contexts
    this.flowContext = new PersistentFlowContext(this.flowId, env.DB);
    this.globalContext = new PersistentGlobalContext(env.DB);
    this.contextManager = new ExecutionContextManager(env.DB, this.contextConfig);
    
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
  // FLOW EXECUTION WITH PERSISTENT CONTEXT
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
      
      // Get conversation ID (from body, header, or generate)
      const conversationId = payload.body?.conversationId 
        || request.headers.get('X-Conversation-ID')
        || request.headers.get('X-Session-ID')
        || 'default';
      
      // Load previous context if exists
      const previousContext = await this.contextManager.getLatestContext(
        route.flowId,
        conversationId
      );
      
      const msg: NodeMessage = {
        _msgid: crypto.randomUUID(),
        payload,
        topic: '',
        conversationId,
        previousContext // Available to nodes
      };
      
      const context: ExecutionContext = {
        storage: this.state.storage,
        env: this.env,
        flow: this.flowContext,
        global: this.globalContext,
        conversationId,
        previousContext
      };
      
      // Execute flow
      const engine = new FlowEngine(route.flowConfig, context, false);
      await engine.initialize();
      
      const result = await engine.triggerFlow(route.nodeId, msg);
      const duration = Date.now() - startTime;
      
      await engine.close();
      
      // Save execution context (with auto-cleanup)
      await this.contextManager.saveContext(
        route.flowId,
        conversationId,
        {
          input: payload,
          output: result,
          duration,
          timestamp: new Date().toISOString(),
          success: true
        }
      );
      
      // Clear in-memory cache for next request
      this.flowContext.clearCache();
      this.globalContext.clearCache();
      
      return this.formatResponse(result, duration, route.flowId, conversationId);
      
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error('[FlowExecutorDO] Error:', err);
      
      // Save error context
      try {
        const conversationId = 'error';
        await this.contextManager.saveContext(
          this.flowId,
          conversationId,
          {
            input: null,
            output: null,
            duration,
            timestamp: new Date().toISOString(),
            success: false,
            error: err.message,
            stack: err.stack
          }
        );
      } catch (saveErr) {
        console.error('[FlowExecutorDO] Error saving error context:', saveErr);
      }
      
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
              global: this.globalContext,
              conversationId: 'scheduled'
            };
            
            const engine = new FlowEngine(route.flowConfig, context, false);
            await engine.initialize();
            
            const msg: NodeMessage = {
              _msgid: crypto.randomUUID(),
              payload: Date.now(),
              topic: 'scheduled',
              conversationId: 'scheduled'
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
  
  private formatResponse(
    result: any, 
    duration: number, 
    flowId: string, 
    conversationId?: string
  ): Response {
    if (result?._httpResponse) {
      const resPayload = result._httpResponse.payload;
      const body = typeof resPayload === 'string' ? resPayload : JSON.stringify(resPayload);
      
      return new Response(body, {
        status: result._httpResponse.statusCode,
        headers: {
          ...result._httpResponse.headers,
          'X-Execution-Time': duration + 'ms',
          'X-Flow-ID': flowId,
          'X-Message-ID': result._msgid,
          'X-Conversation-ID': conversationId || 'default'
        }
      });
    }
    
    return this.jsonResponse({ 
      success: true, 
      duration: duration + 'ms',
      flowId,
      conversationId
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
      case '/internal/debug-execute':
        return await this.handleDebugExecution(request);
        
      case '/internal/status':
        return this.jsonResponse({
          doId: this.state.id.toString(),
          flowId: this.flowId,
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
        this.flowContext.clearCache();
        this.globalContext.clearCache();
        return this.jsonResponse({ success: true, message: 'Storage cleared' });
        
      case '/internal/context-stats':
        const stats = await this.contextManager.getFlowStats(this.flowId);
        return this.jsonResponse(stats);
        
      default:
        return this.errorResponse('Unknown internal endpoint', 404);
    }
  }
  
  // ===================================================================
  // DEBUG EXECUTION (Returns trace to frontend)
  // ===================================================================
  
  private async handleDebugExecution(request: Request): Promise<Response> {
    const executionId = crypto.randomUUID();
    const startTime = new Date().toISOString();
    const startTimeMs = Date.now();
    
    try {
      const body = await request.json();
      const { flowId, nodeId, payload, conversationId } = body;
      
      if (!flowId) {
        return this.errorResponse('flowId is required', 400);
      }
      
      if (!nodeId) {
        return this.errorResponse('nodeId is required', 400);
      }
      
      const convId = conversationId || 'debug';
      
      // Load flow configuration
      const route = await this.lookupFlowById(flowId);
      
      if (!route) {
        return this.errorResponse('Flow not found or disabled', 404);
      }
      
      // Load previous context
      const previousContext = await this.contextManager.getLatestContext(flowId, convId);
      
      // Create execution context with DEBUG MODE enabled
      const context: ExecutionContext = {
        storage: this.state.storage,
        env: this.env,
        flow: this.flowContext,
        global: this.globalContext,
        conversationId: convId,
        previousContext
      };
      
      // Create engine in DEBUG MODE
      const engine = new FlowEngine(route.flowConfig, context, true);
      await engine.initialize();
      
      // Create message
      const msg: NodeMessage = {
        _msgid: crypto.randomUUID(),
        payload: payload || { test: true, manual: true },
        topic: 'debug-execution',
        conversationId: convId,
        previousContext
      };
      
      // Execute flow
      let finalOutput: any = null;
      let executionSuccess = true;
      
      try {
        finalOutput = await engine.triggerFlow(nodeId, msg);
      } catch (err: any) {
        executionSuccess = false;
        console.error('[Debug Execution] Error:', err);
      }
      
      // Get execution trace
      const trace = engine.getTrace();
      
      // Cleanup
      await engine.close();
      
      const endTime = new Date().toISOString();
      const duration = Date.now() - startTimeMs;
      
      // Extract errors from trace
      const errors = trace
        .filter(t => t.status === 'error')
        .map(t => ({
          nodeId: t.nodeId,
          message: t.error || 'Unknown error',
          stack: t.stack
        }));
      
      // Calculate metadata
      const totalNodes = route.flowConfig.nodes.length;
      const executedNodes = new Set(trace.map(t => t.nodeId)).size;
      const errorNodes = errors.length;
      const skippedNodes = totalNodes - executedNodes;
      
      // Get conversation stats
      const conversationCount = await this.contextManager.getConversationCount(flowId, convId);
      
      // Return complete debug result
      return this.jsonResponse({
        success: executionSuccess,
        executionId,
        flowId,
        flowName: route.flowConfig.name,
        conversationId: convId,
        startTime,
        endTime,
        duration,
        entryNodeId: nodeId,
        trace,
        finalOutput,
        errors,
        metadata: {
          totalNodes,
          executedNodes,
          skippedNodes,
          errorNodes,
          conversationCount
        },
        previousContext
      });
      
    } catch (err: any) {
      console.error('[Debug Execution] Fatal error:', err);
      return this.errorResponse(err.message, 500, {
        executionId,
        stack: err.stack
      });
    }
  }
}
