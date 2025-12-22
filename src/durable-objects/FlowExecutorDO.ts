
// ===================================================================
// FlowExecutorDO.ts - Session-Aware Executor
// ===================================================================

import { DurableObject } from 'cloudflare:workers';
import { FlowEngine } from '../core/FlowEngine';
import { FlowConfig, FlowContext, GlobalContext, ExecutionContext, NodeMessage, Env } from '../types/core';

export class FlowExecutorDO extends DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private flowEngines: Map<string, FlowEngine> = new Map(); // Cache multiple flows
  private sessionData: Map<string, any> = new Map(); // In-memory session cache
  private websockets: Map<string, WebSocket> = new Map();
  private flowContext: FlowContext;
  private globalContext: GlobalContext;
  
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    
    // Context wrappers
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
    
    // Set up auto-cleanup alarm (1 hour of inactivity)
    this.setupCleanupAlarm();
  }
  
  // ===================================================================
  // MAIN ENTRY POINT: Handle All Requests for This Session
  // ===================================================================
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // WebSocket upgrade for real-time communication
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }
    
    // Session management endpoints
    if (path.endsWith('/session/info')) {
      return this.handleSessionInfo();
    }
    
    if (path.endsWith('/session/clear')) {
      return this.handleSessionClear();
    }
    
    // Main flow execution
    return this.handleFlowExecution(request);
  }
  
  // ===================================================================
  // Flow Execution (Main Logic)
  // ===================================================================
  private async handleFlowExecution(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api', '');
    const method = request.method.toUpperCase();
    const startTime = Date.now();
    
    try {
      // Update last activity (for cleanup alarm)
      await this.updateLastActivity();
      
      // 1. Route lookup
      const route = await this.lookupRoute(path, method);
      
      if (!route) {
        return this.errorResponse('Route not found', 404, { path, method });
      }
      
      // 2. Load/cache flow engine
      const flowEngine = await this.getOrLoadFlow(route.flowId, route.flowConfig);
      
      // 3. Parse request payload
      const payload = await this.parseRequestPayload(request, path);
      
      // 4. Load session context (conversation history, user data, etc.)
      const sessionContext = await this.loadSessionContext();
      
      // 5. Merge session context into payload
      payload._session = sessionContext;
      
      // 6. Create message
      const msg: NodeMessage = {
        _msgid: crypto.randomUUID(),
        payload,
        topic: ''
      };
      
      // 7. Execute flow
      const result = await flowEngine.triggerFlow(route.nodeId, msg);
      const duration = Date.now() - startTime;
      
      // 8. Update session context if flow modified it
      if (result?._session) {
        await this.saveSessionContext(result._session);
      }
      
      // 9. Broadcast to WebSocket clients if any
      if (this.websockets.size > 0) {
        this.broadcastToWebSockets({
          type: 'flow_result',
          flowId: route.flowId,
          result: result,
          duration
        });
      }
      
      // 10. Log execution (async)
      this.state.blockConcurrencyWhile(async () => 
        await this.logExecution(route.flowId, 'success', duration)
      );
      
      // 11. Return HTTP response
      return this.formatResponse(result, duration, route.flowId);
      
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error('[FlowExecutorDO] Execution error:', err);
      
      // Broadcast error to WebSockets
      if (this.websockets.size > 0) {
        this.broadcastToWebSockets({
          type: 'error',
          error: err.message,
          duration
        });
      }
      
      return this.errorResponse(err.message, 500, { duration });
    }
  }
  
  // ===================================================================
  // WebSocket Support for Real-Time Updates
  // ===================================================================
  private handleWebSocketUpgrade(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    this.state.acceptWebSocket(server);
    
    const wsId = crypto.randomUUID();
    this.websockets.set(wsId, server);
    
    // Send initial connection message
    server.send(JSON.stringify({
      type: 'connected',
      sessionId: this.state.id.toString(),
      timestamp: new Date().toISOString()
    }));
    
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
  
  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    try {
      const msg = JSON.parse(message);
      
      // Handle different message types
      switch (msg.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
          
        case 'execute_flow':
          // Execute flow and stream results
          const result = await this.executeFlowFromWebSocket(msg);
          ws.send(JSON.stringify({
            type: 'flow_result',
            requestId: msg.requestId,
            result
          }));
          break;
          
        case 'get_session':
          const session = await this.loadSessionContext();
          ws.send(JSON.stringify({
            type: 'session_data',
            requestId: msg.requestId,
            session
          }));
          break;
          
        default:
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Unknown message type'
          }));
      }
    } catch (err: any) {
      ws.send(JSON.stringify({
        type: 'error',
        error: err.message
      }));
    }
  }
  
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // Remove from active connections
    for (const [id, socket] of this.websockets.entries()) {
      if (socket === ws) {
        this.websockets.delete(id);
        break;
      }
    }
  }
  
  private broadcastToWebSockets(message: any): void {
    const data = JSON.stringify(message);
    for (const ws of this.websockets.values()) {
      try {
        ws.send(data);
      } catch (err) {
        console.error('[FlowExecutorDO] WebSocket send error:', err);
      }
    }
  }
  
  // ===================================================================
  // Flow Engine Management (Cached)
  // ===================================================================
  private async getOrLoadFlow(flowId: string, flowConfig: FlowConfig): Promise<FlowEngine> {
    // Check memory cache first
    if (this.flowEngines.has(flowId)) {
      return this.flowEngines.get(flowId)!;
    }
    
    // Load and cache
    const context: ExecutionContext = {
      storage: this.state.storage,
      env: this.env,
      flow: this.flowContext,
      global: this.globalContext
    };
    
    const engine = new FlowEngine(flowConfig, context);
    await engine.initialize();
    
    this.flowEngines.set(flowId, engine);
    return engine;
  }
  
  // ===================================================================
  // Session Context Management
  // ===================================================================
  private async loadSessionContext(): Promise<any> {
    // Check memory cache
    if (this.sessionData.has('context')) {
      return this.sessionData.get('context');
    }
    
    // Load from durable storage
    const stored = await this.state.storage.get('session:context');
    const context = stored || {
      createdAt: new Date().toISOString(),
      messages: [],
      userData: {}
    };
    
    this.sessionData.set('context', context);
    return context;
  }
  
  private async saveSessionContext(context: any): Promise<void> {
    this.sessionData.set('context', context);
    await this.state.storage.put('session:context', context);
  }
  
  // ===================================================================
  // Route Lookup
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
  // Request Parsing
  // ===================================================================
  private async parseRequestPayload(request: Request, path: string): Promise<any> {
    const url = new URL(request.url);
    const contentType = request.headers.get('content-type') || '';
    
    let body: any = null;
    
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
  // Response Formatting
  // ===================================================================
  private formatResponse(result: any, duration: number, flowId: string): Response {
    if (result?._httpResponse) {
      const resPayload = result._httpResponse.payload;
      return new Response(
        typeof resPayload === 'string' ? resPayload : JSON.stringify(resPayload),
        {
          status: result._httpResponse.statusCode,
          headers: {
            ...result._httpResponse.headers,
            'X-Execution-Time': duration + 'ms',
            'X-Flow-ID': flowId
          }
        }
      );
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      duration: duration + 'ms',
      flowId
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  private errorResponse(message: string, status: number, extra?: any): Response {
    return new Response(JSON.stringify({ 
      error: message,
      ...extra
    }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // ===================================================================
  // Session Management Endpoints
  // ===================================================================
  private async handleSessionInfo(): Promise<Response> {
    const context = await this.loadSessionContext();
    const logs = await this.state.storage.list({ prefix: 'log:' });
    
    return new Response(JSON.stringify({
      sessionId: this.state.id.toString(),
      context,
      activeWebSockets: this.websockets.size,
      cachedFlows: Array.from(this.flowEngines.keys()),
      logCount: logs.size,
      lastActivity: await this.state.storage.get('last_activity')
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  private async handleSessionClear(): Promise<Response> {
    // Clear memory caches
    this.flowEngines.clear();
    this.sessionData.clear();
    
    // Clear durable storage (keep logs for debugging)
    const keysToDelete: string[] = [];
    const allKeys = await this.state.storage.list();
    
    for (const key of allKeys.keys()) {
      if (!key.startsWith('log:')) {
        keysToDelete.push(key);
      }
    }
    
    await this.state.storage.delete(keysToDelete);
    
    return new Response(JSON.stringify({ 
      success: true,
      cleared: keysToDelete.length
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // ===================================================================
  // Cleanup & Alarms
  // ===================================================================
  private async updateLastActivity(): Promise<void> {
    await this.state.storage.put('last_activity', Date.now());
  }
  
  private async setupCleanupAlarm(): Promise<void> {
    const lastActivity = await this.state.storage.get<number>('last_activity');
    if (!lastActivity) {
      await this.updateLastActivity();
    }
    
    // Set alarm for 1 hour from now
    await this.state.storage.setAlarm(Date.now() + 3600000);
  }
  
  async alarm(): Promise<void> {
    const lastActivity = await this.state.storage.get<number>('last_activity') || 0;
    const now = Date.now();
    const inactiveTime = now - lastActivity;
    
    // If inactive for > 1 hour, clear caches
    if (inactiveTime > 3600000) {
      console.log('[FlowExecutorDO] Cleaning up inactive session');
      this.flowEngines.clear();
      this.sessionData.clear();
      
      // Optionally clear storage too
      // await this.state.storage.deleteAll();
    }
    
    // Set next alarm
    await this.state.storage.setAlarm(now + 3600000);
  }
  
  // ===================================================================
  // Logging
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
      
      // Keep last 100 logs
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
  // WebSocket Flow Execution
  // ===================================================================
  private async executeFlowFromWebSocket(msg: any): Promise<any> {
    const { flowId, nodeId, payload } = msg;
    
    // This would need actual flow lookup - simplified for example
    throw new Error('Not implemented - use HTTP endpoint');
  }
}

// ===================================================================
// index.ts - Session-Aware Worker
// ===================================================================

import { Env } from './types/core';
import { handleAdmin } from './handlers/adminHandler';

export { FlowExecutorDO } from './durable-objects/FlowExecutorDO';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Session-ID',
        }
      });
    }
    
    // Admin endpoints
    if (path.startsWith('/admin/')) {
      return handleAdmin(request, env);
    }
    
    // API endpoints - route by session
    if (path.startsWith('/api/')) {
      if (!env.FLOW_EXECUTOR) {
        return new Response(JSON.stringify({ 
          error: 'Flow executor not configured'
        }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Get or create session ID
      let sessionId = 
        url.searchParams.get('session_id') ||
        request.headers.get('X-Session-ID');
      
      if (!sessionId) {
        // Generate new session for new users
        sessionId = crypto.randomUUID();
      }
      
      // Route to session-specific DO
      const doId = env.FLOW_EXECUTOR.idFromName(sessionId);
      const doStub = env.FLOW_EXECUTOR.get(doId);
      
      // Forward request with session ID in header
      const modifiedRequest = new Request(request.url, {
        method: request.method,
        headers: {
          ...Object.fromEntries(request.headers),
          'X-Session-ID': sessionId
        },
        body: request.body
      });
      
      const response = await doStub.fetch(modifiedRequest);
      
      // Add session ID to response headers
      const modifiedResponse = new Response(response.body, {
        status: response.status,
        headers: {
          ...Object.fromEntries(response.headers),
          'X-Session-ID': sessionId
        }
      });
      
      return modifiedResponse;
    }
    
    // Health check
    if (path === '/health') {
      return new Response(JSON.stringify({ 
        status: 'ok',
        version: '2.0.0'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({
      name: 'RedNox',
      version: '2.0.0',
      endpoints: {
        admin: '/admin/flows',
        api: '/api/{path}?session_id={uuid}',
        websocket: 'wss://{host}/api/{path}?session_id={uuid}',
        health: '/health'
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
