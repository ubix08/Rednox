
// ===================================================================
// index.ts - CORRECTED Worker Entry Point
// ===================================================================

import { Env } from './types/core';
import { handleAdmin } from './handlers/adminHandler';

// Import nodes to register them
import './nodes';

// Export the DO (ONLY ONCE!)
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
          'Access-Control-Allow-Headers': 'Content-Type, X-Session-ID, X-User-ID, Authorization',
        }
      });
    }
    
    // Admin endpoints
    if (path.startsWith('/admin/')) {
      return handleAdmin(request, env);
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
    
    // API routing
    if (path.startsWith('/api/')) {
      return routeToAppropriateSharding(request, env);
    }
    
    return new Response(JSON.stringify({
      name: 'RedNox',
      version: '2.0.0',
      patterns: {
        session: '/api/chat/{path}?session_id={uuid}',
        user: '/api/user/{tool} (requires X-User-ID)',
        job: '/api/jobs/submit',
        workspace: '/api/workspace/{id}/{action}',
        stateless: '/api/tools/{toolName}'
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// ===================================================================
// Smart Routing Logic
// ===================================================================

async function routeToAppropriateSharding(
  request: Request, 
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  
  if (!env.FLOW_EXECUTOR) {
    return new Response(JSON.stringify({ 
      error: 'Flow executor not configured'
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Pattern detection by URL prefix
  if (path.startsWith('/api/chat/')) {
    return routeBySession(request, env);
  }
  
  if (path.startsWith('/api/user/')) {
    return routeByUser(request, env);
  }
  
  if (path.startsWith('/api/jobs/')) {
    return routeByJob(request, env);
  }
  
  if (path.startsWith('/api/workspace/')) {
    return routeByWorkspace(request, env);
  }
  
  if (path.startsWith('/api/tools/')) {
    return routeStatelessTool(request, env);
  }
  
  // Default: Session-based for backwards compatibility
  return routeBySession(request, env);
}

// Session-based routing
async function routeBySession(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  
  let sessionId = 
    url.searchParams.get('session_id') ||
    request.headers.get('X-Session-ID');
  
  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }
  
  const doId = env.FLOW_EXECUTOR.idFromName(`session:${sessionId}`);
  const doStub = env.FLOW_EXECUTOR.get(doId);
  
  const modifiedRequest = new Request(request.url, {
    method: request.method,
    headers: {
      ...Object.fromEntries(request.headers),
      'X-Session-ID': sessionId,
      'X-Sharding-Type': 'session'
    },
    body: request.body
  });
  
  const response = await doStub.fetch(modifiedRequest);
  
  return new Response(response.body, {
    status: response.status,
    headers: {
      ...Object.fromEntries(response.headers),
      'X-Session-ID': sessionId
    }
  });
}

// User-based routing
async function routeByUser(request: Request, env: Env): Promise<Response> {
  const userId = 
    request.headers.get('X-User-ID') ||
    await extractUserIdFromAuth(request);
  
  if (!userId) {
    return new Response(JSON.stringify({ 
      error: 'Authentication required',
      hint: 'Provide X-User-ID header or Authorization token'
    }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const doId = env.FLOW_EXECUTOR.idFromName(`user:${userId}`);
  const doStub = env.FLOW_EXECUTOR.get(doId);
  
  const modifiedRequest = new Request(request.url, {
    method: request.method,
    headers: {
      ...Object.fromEntries(request.headers),
      'X-User-ID': userId,
      'X-Sharding-Type': 'user'
    },
    body: request.body
  });
  
  return doStub.fetch(modifiedRequest);
}

// Job-based routing
async function routeByJob(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  
  if (pathParts[3] === 'submit' && request.method === 'POST') {
    const jobId = crypto.randomUUID();
    const userId = request.headers.get('X-User-ID');
    
    const doId = env.FLOW_EXECUTOR.idFromName(`job:${jobId}`);
    const doStub = env.FLOW_EXECUTOR.get(doId);
    
    const jobRequest = new Request(`${url.origin}/internal/job/process`, {
      method: 'POST',
      headers: {
        ...Object.fromEntries(request.headers),
        'X-Job-ID': jobId,
        'X-User-ID': userId || 'anonymous',
        'X-Sharding-Type': 'job'
      },
      body: request.body
    });
    
    // Fire and forget
    doStub.fetch(jobRequest);
    
    return new Response(JSON.stringify({
      jobId,
      status: 'queued',
      statusUrl: `/api/jobs/${jobId}/status`,
      resultUrl: `/api/jobs/${jobId}/result`
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const jobId = pathParts[3];
  if (!jobId || jobId === 'submit') {
    return new Response(JSON.stringify({ error: 'Invalid job ID' }), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const doId = env.FLOW_EXECUTOR.idFromName(`job:${jobId}`);
  const doStub = env.FLOW_EXECUTOR.get(doId);
  
  const modifiedRequest = new Request(request.url, {
    method: request.method,
    headers: {
      ...Object.fromEntries(request.headers),
      'X-Job-ID': jobId,
      'X-Sharding-Type': 'job'
    }
  });
  
  return doStub.fetch(modifiedRequest);
}

// Workspace-based routing
async function routeByWorkspace(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const workspaceId = pathParts[3];
  
  if (!workspaceId) {
    return new Response(JSON.stringify({ error: 'Workspace ID required' }), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const doId = env.FLOW_EXECUTOR.idFromName(`workspace:${workspaceId}`);
  const doStub = env.FLOW_EXECUTOR.get(doId);
  
  const modifiedRequest = new Request(request.url, {
    method: request.method,
    headers: {
      ...Object.fromEntries(request.headers),
      'X-Workspace-ID': workspaceId,
      'X-Sharding-Type': 'workspace'
    },
    body: request.body
  });
  
  return doStub.fetch(modifiedRequest);
}

// Stateless tool routing
async function routeStatelessTool(request: Request, env: Env): Promise<Response> {
  const doId = env.FLOW_EXECUTOR.idFromName('global');
  const doStub = env.FLOW_EXECUTOR.get(doId);
  
  const modifiedRequest = new Request(request.url, {
    method: request.method,
    headers: {
      ...Object.fromEntries(request.headers),
      'X-Sharding-Type': 'global'
    },
    body: request.body
  });
  
  return doStub.fetch(modifiedRequest);
}

// Helper: Extract user ID from auth token
async function extractUserIdFromAuth(request: Request): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.substring(7);
  
  // TODO: Validate JWT and extract user ID
  // For now, use token as user ID
  return token;
}

// ===================================================================
// FlowExecutorDO.ts - CORRECTED (No Duplication)
// ===================================================================

import { DurableObject } from 'cloudflare:workers';
import { FlowEngine } from '../core/FlowEngine';
import { FlowConfig, FlowContext, GlobalContext, ExecutionContext, NodeMessage } from '../types/core';

export class FlowExecutorDO extends DurableObject {
  private state: DurableObjectState;
  private env: any; // Using 'any' to avoid circular dependency
  private flowEngines: Map<string, FlowEngine> = new Map();
  private sessionData: Map<string, any> = new Map();
  private websockets: Map<string, WebSocket> = new Map();
  private flowContext: FlowContext;
  private globalContext: GlobalContext;
  private shardingType?: string;
  
  constructor(state: DurableObjectState, env: any) {
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
    
    // Admin endpoints (RPC-style)
    if (url.pathname === '/internal/session/info') {
      return this.handleSessionInfo();
    }
    
    if (url.pathname === '/internal/session/clear') {
      return this.handleSessionClear();
    }
    
    if (url.pathname === '/internal/debug/messages') {
      return this.handleDebugMessages();
    }
    
    if (url.pathname === '/internal/status') {
      return this.handleStatus();
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
  // Flow Execution (Main Logic)
  // ===================================================================
  private async handleFlowExecution(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api', '').replace('/api/chat', '');
    const method = request.method.toUpperCase();
    const startTime = Date.now();
    
    try {
      await this.updateLastActivity();
      
      // Route lookup
      const route = await this.lookupRoute(path, method);
      
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
      
      // Broadcast to WebSockets
      if (this.websockets.size > 0) {
        this.broadcastToWebSockets({
          type: 'flow_result',
          flowId: route.flowId,
          result,
          duration
        });
      }
      
      // Log async
      this.state.blockConcurrencyWhile(async () => 
        await this.logExecution(route.flowId, 'success', duration)
      );
      
      return this.formatResponse(result, duration, route.flowId);
      
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error('[FlowExecutorDO] Error:', err);
      return this.errorResponse(err.message, 500, { duration });
    }
  }
  
  // User request handler
  private async handleUserRequest(request: Request): Promise<Response> {
    const userId = request.headers.get('X-User-ID')!;
    
    if (!await this.checkRateLimit(userId)) {
      return this.errorResponse('Rate limit exceeded', 429);
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
      this.processJobInBackground(request, jobId);
      return new Response(JSON.stringify({ started: true, jobId }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname.includes('/status')) {
      const status = await this.state.storage.get('job:status');
      return new Response(JSON.stringify(status || { state: 'not_found' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname.includes('/result')) {
      const result = await this.state.storage.get('job:result');
      return new Response(JSON.stringify(result || { error: 'No result available' }), {
        headers: { 'Content-Type': 'application/json' }
      });
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
      global: this.globalContext
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
      } else if (contentType.includes('application/x-www-form-urlencoded') ||
                 contentType.includes('multipart/form-data')) {
        try {
          const formData = await request.formData();
          body = Object.fromEntries(formData);
        } catch {
          body = await request.text();
        }
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
  // Admin/RPC Endpoints
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
    this.flowEngines.clear();
    this.sessionData.clear();
    
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
  
  private async handleDebugMessages(): Promise<Response> {
    const allDebug = await this.state.storage.list({ prefix: 'debug:' });
    const messages: any[] = [];
    
    for (const [key, value] of allDebug.entries()) {
      messages.push({ key, ...value as any });
    }
    
    messages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    return new Response(JSON.stringify({
      messages: messages.slice(0, 100)
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  private async handleStatus(): Promise<Response> {
    return new Response(JSON.stringify({
      loaded: this.flowEngines.size > 0,
      flowIds: Array.from(this.flowEngines.keys()),
      nodeCount: Array.from(this.flowEngines.values()).reduce((sum, engine: any) => 
        sum + (engine.flowConfig?.nodes?.length || 0), 0
      ),
      shardingType: this.shardingType
    }), {
      headers: { 'Content-Type': 'application/json' }
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
  
  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    try {
      const msg = JSON.parse(message);
      
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
  
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
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
  // Rate Limiting & Usage
  // ===================================================================
  private async checkRateLimit(userId: string): Promise<boolean> {
    const key = `ratelimit:${userId}`;
    const now = Date.now();
    const windowMs = 60000;
    const maxRequests = 100;
