
// ===================================================================
// FlowExecutorDO.ts - Enhanced with Caching & Optimization
// ===================================================================

import { DurableObject } from 'cloudflare:workers';
import { FlowEngine } from '../core/FlowEngine';
import { 
  FlowConfig, FlowContext, GlobalContext, ExecutionContext, 
  NodeMessage, Env, RouteCache 
} from '../types/core';
import { 
  StorageKeys, BatchedStorageImpl, RateLimiter 
} from '../utils';

export class FlowExecutorDO extends DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private flowEngines: Map<string, FlowEngine> = new Map();
  private sessionData: Map<string, any> = new Map();
  private websockets: Map<string, WebSocket> = new Map();
  private flowContext: FlowContext;
  private globalContext: GlobalContext;
  private shardingType?: string;
  private routeCache: Map<string, RouteCache> = new Map();
  private rateLimiter: RateLimiter;
  private batchedStorage: BatchedStorageImpl;
  
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    
    // Initialize batched storage
    this.batchedStorage = new BatchedStorageImpl(state.storage, 100);
    
    // Initialize rate limiter
    this.rateLimiter = new RateLimiter(state.storage);
    
    // Flow context with storage keys
    this.flowContext = {
      get: async (key: string) => 
        await this.batchedStorage.get(StorageKeys.flow(key)),
      set: async (key: string, value: any) => 
        await this.batchedStorage.set(StorageKeys.flow(key), value),
      keys: async () => {
        const list = await this.state.storage.list({ 
          prefix: StorageKeys.listPrefix('f:') 
        });
        return Array.from(list.keys()).map(k => k.replace('f:', ''));
      }
    };
    
    // Global context with storage keys
    this.globalContext = {
      get: async (key: string) => 
        await this.batchedStorage.get(StorageKeys.global(key)),
      set: async (key: string, value: any) => 
        await this.batchedStorage.set(StorageKeys.global(key), value),
      keys: async () => {
        const list = await this.state.storage.list({ 
          prefix: StorageKeys.listPrefix('g:') 
        });
        return Array.from(list.keys()).map(k => k.replace('g:', ''));
      }
    };
    
    this.setupCleanupAlarm();
  }
  
  // ===================================================================
  // MAIN ENTRY POINT
  // ===================================================================
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.shardingType = request.headers.get('X-Sharding-Type') || 'session';
    
    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }
    
    // Internal/Admin endpoints
    if (url.pathname.startsWith('/internal/')) {
      return this.handleInternalRequest(url.pathname, request);
    }
    
    // Route to pattern-specific handler
    switch (this.shardingType) {
      case 'job':
        return this.handleJobRequest(request);
      case 'user':
        return this.handleUserRequest(request);
      case 'workspace':
        return this.handleWorkspaceRequest(request);
      case 'global':
        return this.handleStatelessRequest(request);
      case 'session':
      default:
        return this.handleFlowExecution(request);
    }
  }
  
  // ===================================================================
  // Internal Endpoints
  // ===================================================================
  private async handleInternalRequest(pathname: string, request: Request): Promise<Response> {
    switch (pathname) {
      case '/internal/session/info':
        return this.handleSessionInfo();
      case '/internal/session/clear':
        return this.handleSessionClear();
      case '/internal/debug/messages':
        return this.handleDebugMessages();
      case '/internal/status':
        return this.handleStatus();
      case '/internal/cache/clear':
        return this.handleCacheClear();
      default:
        return this.errorResponse('Unknown internal endpoint', 404);
    }
  }
  
  // ===================================================================
  // Flow Execution (Main Logic)
  // ===================================================================
  private async handleFlowExecution(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api', '').replace('/api/chat', '');
    const method = request.method.toUpperCase();
    const startTime = Date.now();
    
    try {
      await this.updateLastActivity();
      
      // Route lookup with caching
      const route = await this.lookupRouteWithCache(path, method);
      
      if (!route) {
        return this.errorResponse('Route not found', 404, { path, method });
      }
      
      // Load flow engine
      const flowEngine = await this.getOrLoadFlow(route.flowId, route.flowConfig);
      
      // Parse request
      const payload = await this.parseRequestPayload(request, path);
      
      // Load session context
      const sessionContext = await this.loadSessionContext();
      payload._session = sessionContext;
      
      // Create message
      const msg: NodeMessage = {
        _msgid: crypto.randomUUID(),
        payload,
        topic: ''
      };
      
      // Execute flow
      const result = await flowEngine.triggerFlow(route.nodeId, msg);
      const duration = Date.now() - startTime;
      
      // Update session
      if (result?._session) {
        await this.saveSessionContext(result._session);
      }
      
      // Flush batched storage
      await this.batchedStorage.flush();
      
      // Broadcast to WebSockets
      if (this.websockets.size > 0) {
        this.broadcastToWebSockets({
          type: 'flow_result',
          flowId: route.flowId,
          result,
          duration
        });
      }
      
      // Log async (non-blocking)
      this.ctx.waitUntil(this.logExecution(route.flowId, 'success', duration));
      
      return this.formatResponse(result, duration, route.flowId);
      
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error('[FlowExecutorDO] Error:', err);
      
      // Ensure storage is flushed even on error
      await this.batchedStorage.flush();
      
      return this.errorResponse(err.message, 500, { 
        duration,
        stack: err.stack 
      });
    }
  }
  
  // User request handler with rate limiting
  private async handleUserRequest(request: Request): Promise<Response> {
    const userId = request.headers.get('X-User-ID');
    
    if (!userId) {
      return this.errorResponse('User ID required', 401);
    }
    
    // Check rate limit
    const rateLimits = this.env.RATE_LIMIT || { requests: 100, window: 60000 };
    if (!await this.rateLimiter.check(userId, rateLimits)) {
      return this.errorResponse('Rate limit exceeded', 429, {
        retryAfter: Math.ceil(rateLimits.window / 1000)
      });
    }
    
    const result = await this.handleFlowExecution(request);
    await this.updateUsageStats(userId);
    
    return result;
  }
  
  // Job request handler
  private async handleJobRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const jobId = request.headers.get('X-Job-ID')!;
    
    if (url.pathname.includes('/process')) {
      this.ctx.waitUntil(this.processJobInBackground(request, jobId));
      return this.jsonResponse({ started: true, jobId }, 202);
    }
    
    if (url.pathname.includes('/status')) {
      const status = await this.state.storage.get(StorageKeys.job('status'));
      return this.jsonResponse(status || { state: 'not_found' });
    }
    
    if (url.pathname.includes('/result')) {
      const result = await this.state.storage.get(StorageKeys.job('result'));
      return this.jsonResponse(result || { error: 'No result available' });
    }
    
    return this.errorResponse('Invalid job endpoint', 404);
  }
  
  // Workspace request handler
  private async handleWorkspaceRequest(request: Request): Promise<Response> {
    return this.handleFlowExecution(request);
  }
  
  // Stateless request handler
  private async handleStatelessRequest(request: Request): Promise<Response> {
    return this.handleFlowExecution(request);
  }
  
  // ===================================================================
  // Flow Engine Management
  // ===================================================================
  private async getOrLoadFlow(flowId: string, flowConfig: FlowConfig): Promise<FlowEngine> {
    if (this.flowEngines.has(flowId)) {
      return this.flowEngines.get(flowId)!;
    }
    
    const context: ExecutionContext = {
      storage: this.state.storage,
      env: this.env,
      flow: this.flowContext,
      global: this.globalContext,
      batchedStorage: this.batchedStorage
    };
    
    const engine = new FlowEngine(flowConfig, context);
    await engine.initialize();
    
    this.flowEngines.set(flowId, engine);
    return engine;
  }
  
  // ===================================================================
  // Session Management
  // ===================================================================
  private async loadSessionContext(): Promise<any> {
    if (this.sessionData.has('context')) {
      return this.sessionData.get('context');
    }
    
    const stored = await this.state.storage.get(StorageKeys.session('context'));
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
    await this.batchedStorage.set(StorageKeys.session('context'), context);
  }
  
  // ===================================================================
  // Route Lookup with Caching
  // ===================================================================
  private async lookupRouteWithCache(path: string, method: string): Promise<{
    flowId: string;
    nodeId: string;
    flowConfig: FlowConfig;
  } | null> {
    const cacheKey = `${method}:${path}`;
    const cached = this.routeCache.get(cacheKey);
    
    // Check cache
    if (cached && Date.now() < cached.expiry) {
      return {
        flowId: cached.flowId,
        nodeId: cached.nodeId,
        flowConfig: cached.flowConfig
      };
    }
    
    // Fetch from database
    const route = await this.lookupRoute(path, method);
    
    // Cache result
    if (route) {
      this.routeCache.set(cacheKey, {
        ...route,
        expiry: Date.now() + 60000 // 1 minute cache
      });
    }
    
    return route;
  }
  
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
      try {
        if (contentType.includes('application/json')) {
          body = await request.json();
        } else if (contentType.includes('application/x-www-form-urlencoded') ||
                   contentType.includes('multipart/form-data')) {
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
  // Response Formatting
  // ===================================================================
  private formatResponse(result: any, duration: number, flowId: string): Response {
    if (result?._httpResponse) {
      const resPayload = result._httpResponse.payload;
      const body = typeof resPayload === 'string' ? resPayload : JSON.stringify(resPayload);
      
      // Stream large responses
      if (body.length > 1_000_000) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(body));
              controller.close();
            }
          }),
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
      
      return new Response(body, {
        status: result._httpResponse.statusCode,
        headers: {
          ...result._httpResponse.headers,
          'X-Execution-Time': duration + 'ms',
          'X-Flow-ID': flowId,
          'X-Trace-ID': result._msgid
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
  // Admin/RPC Endpoints
  // ===================================================================
  private async handleSessionInfo(): Promise<Response> {
    const context = await this.loadSessionContext();
    const logs = await this.state.storage.list({ prefix: StorageKeys.listPrefix('l:') });
    
    return this.jsonResponse({
      sessionId: this.state.id.toString(),
      context,
      activeWebSockets: this.websockets.size,
      cachedFlows: Array.from(this.flowEngines.keys()),
      cachedRoutes: this.routeCache.size,
      logCount: logs.size,
      lastActivity: await this.state.storage.get('last_activity')
    });
  }
  
  private async handleSessionClear(): Promise<Response> {
    // Close flow engines
    for (const engine of this.flowEngines.values()) {
      await engine.close();
    }
    
    this.flowEngines.clear();
    this.sessionData.clear();
    this.routeCache.clear();
    
    const keysToDelete: string[] = [];
    const allKeys = await this.state.storage.list();
    
    for (const key of allKeys.keys()) {
      if (!key.startsWith('l:')) { // Keep logs
        keysToDelete.push(key);
      }
    }
    
    await this.state.storage.delete(keysToDelete);
    
    return this.jsonResponse({ 
      success: true,
      cleared: keysToDelete.length
    });
  }
  
  private async handleCacheClear(): Promise<Response> {
    this.routeCache.clear();
    return this.jsonResponse({ success: true, message: 'Cache cleared' });
  }
  
  private async handleDebugMessages(): Promise<Response> {
    const allDebug = await this.state.storage.list({ prefix: StorageKeys.listPrefix('d:') });
    const messages: any[] = [];
    
    for (const [key, value] of allDebug.entries()) {
      messages.push({ key, ...value as any });
    }
    
    messages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    return this.jsonResponse({
      messages: messages.slice(0, 100)
    });
  }
  
  private async handleStatus(): Promise<Response> {
    return this.jsonResponse({
      loaded: this.flowEngines.size > 0,
      flowIds: Array.from(this.flowEngines.keys()),
      nodeCount: Array.from(this.flowEngines.values()).reduce((sum, engine: any) => 
        sum + (engine.flowConfig?.nodes?.length || 0), 0
      ),
      shardingType: this.shardingType,
      cacheSize: this.routeCache.size
    });
  }
  
  // ===================================================================
  // WebSocket Support
  // ===================================================================
  private handleWebSocketUpgrade(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    this.state.acceptWebSocket(server);
    
    const wsId = crypto.randomUUID();
    this.websockets.set(wsId, server);
    
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
  
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const msg = typeof message === 'string' ? JSON.parse(message) : null;
      
      if (!msg) return;
      
      switch (msg.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
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
  
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    for (const [id, socket] of this.websockets.entries()) {
      if (socket === ws) {
        this.websockets.delete(id);
        break;
      }
    }
  }
  
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[FlowExecutorDO] WebSocket error:', error);
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
  // Usage & Stats
  // ===================================================================
  private async updateUsageStats(userId: string): Promise<void> {
    const stats = await this.state.storage.get<any>(StorageKeys.usage()) || {
      totalRequests: 0,
      lastRequest: null,
      userRequests: {}
    };
    
    stats.totalRequests++;
    stats.lastRequest = new Date().toISOString();
    stats.userRequests[userId] = (stats.userRequests[userId] || 0) + 1;
    
    await this.batchedStorage.set(StorageKeys.usage(), stats);
  }
  
  // ===================================================================
  // Background Job Processing
  // ===================================================================
  private async processJobInBackground(request: Request, jobId: string): Promise<void> {
    try {
      await this.state.storage.put(StorageKeys.job('status'), {
        state: 'processing',
        progress: 0,
        startedAt: Date.now()
      });
      
      const data = await request.json();
      const url = new URL(request.url);
      const path = url.pathname.replace('/internal/job/process', '');
      const method = 'POST';
      
      const route = await this.lookupRouteWithCache(path || '/job', method);
      
      if (route) {
        const flowEngine = await this.getOrLoadFlow(route.flowId, route.flowConfig);
        
        const msg: NodeMessage = {
          _msgid: crypto.randomUUID(),
          payload: data,
          topic: 'job'
        };
        
        const result = await flowEngine.triggerFlow(route.nodeId, msg);
        
        await this.state.storage.put(StorageKeys.job('status'), {
          state: 'completed',
          progress: 100,
          completedAt: Date.now()
        });
        
        await this.state.storage.put(StorageKeys.job('result'), {
          success: true,
          data: result
        });
      } else {
        throw new Error('No job processing flow found');
      }
      
    } catch (err: any) {
      await this.state.storage.put(StorageKeys.job('status'), {
        state: 'failed',
        error: err.message
      });
    }
  }
  
  // ===================================================================
  // Cleanup & Alarms
  // ===================================================================
  private async updateLastActivity(): Promise<void> {
    await this.state.storage.put('last_activity', Date.now());
  }
  
  private async setupCleanupAlarm(): Promise<void> {
    const currentAlarm = await this.state.storage.getAlarm();
    if (!currentAlarm) {
      await this.state.storage.setAlarm(Date.now() + 3600000);
    }
  }
  
  async alarm(): Promise<void> {
    const lastActivity = await this.state.storage.get<number>('last_activity') || 0;
    const now = Date.now();
    const inactiveTime = now - lastActivity;
    
    // Cleanup after 1 hour of inactivity
    if (inactiveTime > 3600000) {
      console.log('[FlowExecutorDO] Cleaning up inactive session');
      
      for (const engine of this.flowEngines.values()) {
        await engine.close();
      }
      
      this.flowEngines.clear();
      this.sessionData.clear();
      this.routeCache.clear();
    }
    
    // Cleanup old debug messages
    const debugKeys = await this.state.storage.list({ prefix: StorageKeys.listPrefix('d:') });
    if (debugKeys.size > 1000) {
      const toDelete = Array.from(debugKeys.keys())
        .sort()
        .slice(0, debugKeys.size - 1000);
      await this.state.storage.delete(toDelete);
    }
    
    // Cleanup old logs
    const logKeys = await this.state.storage.list({ prefix: StorageKeys.listPrefix('l:') });
    if (logKeys.size > 100) {
      const toDelete = Array.from(logKeys.keys())
        .sort()
        .slice(0, logKeys.size - 100);
      await this.state.storage.delete(toDelete);
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
      await this.state.storage.put(StorageKeys.log(Date.now()), {
        flowId,
        status,
        duration,
        errorMessage: errorMessage || null,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('[FlowExecutorDO] Failed to log:', err);
    }
  }
}
