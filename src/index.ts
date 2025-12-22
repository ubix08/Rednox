
// ===================================================================
// index.ts - Smart Router for All AI Tool Patterns
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
    
    // API routing - determine sharding strategy
    if (path.startsWith('/api/')) {
      return routeToAppropriateSharding(request, env);
    }
    
    return new Response(JSON.stringify({
      name: 'RedNox',
      version: '2.0.0',
      patterns: {
        chatbot: '/api/chat/{path}?session_id={uuid}',
        user_tools: '/api/user/{tool}',
        jobs: '/api/jobs/{action}',
        workspace: '/api/workspace/{workspaceId}/{action}',
        tools: '/api/tools/{toolName}'
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
  
  // PATTERN 1: Chatbot (Session-based sharding)
  if (path.startsWith('/api/chat/')) {
    return routeBySession(request, env);
  }
  
  // PATTERN 2: User Tools (User-based sharding)
  if (path.startsWith('/api/user/')) {
    return routeByUser(request, env);
  }
  
  // PATTERN 3: Job Queue (Job-based sharding)
  if (path.startsWith('/api/jobs/')) {
    return routeByJob(request, env);
  }
  
  // PATTERN 4: Collaborative Workspace (Resource-based sharding)
  if (path.startsWith('/api/workspace/')) {
    return routeByWorkspace(request, env);
  }
  
  // PATTERN 5: Stateless Tools (Global or load-balanced)
  if (path.startsWith('/api/tools/')) {
    return routeStatelessTool(request, env);
  }
  
  // Default: Try to determine from route config
  return routeByFlowConfig(request, env);
}

// ===================================================================
// Pattern 1: Session-Based Routing (Chatbots)
// ===================================================================

async function routeBySession(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  
  // Get or create session ID
  let sessionId = 
    url.searchParams.get('session_id') ||
    request.headers.get('X-Session-ID');
  
  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }
  
  // Route to session-specific DO
  const doId = env.FLOW_EXECUTOR.idFromName(`session:${sessionId}`);
  const doStub = env.FLOW_EXECUTOR.get(doId);
  
  const response = await doStub.fetch(addHeaders(request, {
    'X-Session-ID': sessionId,
    'X-Sharding-Type': 'session'
  }));
  
  return addResponseHeaders(response, {
    'X-Session-ID': sessionId
  });
}

// ===================================================================
// Pattern 2: User-Based Routing (User Tools)
// ===================================================================

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
  
  // Route to user-specific DO
  const doId = env.FLOW_EXECUTOR.idFromName(`user:${userId}`);
  const doStub = env.FLOW_EXECUTOR.get(doId);
  
  return doStub.fetch(addHeaders(request, {
    'X-User-ID': userId,
    'X-Sharding-Type': 'user'
  }));
}

// ===================================================================
// Pattern 3: Job-Based Routing (Background Jobs)
// ===================================================================

async function routeByJob(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  
  // POST /api/jobs/submit - Create new job
  if (pathParts[3] === 'submit' && request.method === 'POST') {
    const jobId = crypto.randomUUID();
    const userId = request.headers.get('X-User-ID');
    
    const doId = env.FLOW_EXECUTOR.idFromName(`job:${jobId}`);
    const doStub = env.FLOW_EXECUTOR.get(doId);
    
    // Start job processing
    const jobRequest = new Request(`${url.origin}/api/jobs/${jobId}/process`, {
      method: 'POST',
      headers: {
        ...Object.fromEntries(request.headers),
        'X-Job-ID': jobId,
        'X-User-ID': userId || 'anonymous',
        'X-Sharding-Type': 'job'
      },
      body: request.body
    });
    
    // Fire and forget (job runs in background)
    doStub.fetch(jobRequest);
    
    // Return immediately with job ID
    return new Response(JSON.stringify({
      jobId,
      status: 'queued',
      statusUrl: `/api/jobs/${jobId}/status`,
      resultUrl: `/api/jobs/${jobId}/result`
    }), {
      status: 202, // Accepted
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // GET /api/jobs/{jobId}/status - Check status
  // GET /api/jobs/{jobId}/result - Get result
  const jobId = pathParts[3];
  
  if (!jobId || jobId === 'submit') {
    return new Response(JSON.stringify({ 
      error: 'Invalid job ID'
    }), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const doId = env.FLOW_EXECUTOR.idFromName(`job:${jobId}`);
  const doStub = env.FLOW_EXECUTOR.get(doId);
  
  return doStub.fetch(addHeaders(request, {
    'X-Job-ID': jobId,
    'X-Sharding-Type': 'job'
  }));
}

// ===================================================================
// Pattern 4: Workspace-Based Routing (Collaborative Tools)
// ===================================================================

async function routeByWorkspace(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const workspaceId = pathParts[3];
  
  if (!workspaceId) {
    return new Response(JSON.stringify({ 
      error: 'Workspace ID required'
    }), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Route to workspace-specific DO
  const doId = env.FLOW_EXECUTOR.idFromName(`workspace:${workspaceId}`);
  const doStub = env.FLOW_EXECUTOR.get(doId);
  
  return doStub.fetch(addHeaders(request, {
    'X-Workspace-ID': workspaceId,
    'X-Sharding-Type': 'workspace'
  }));
}

// ===================================================================
// Pattern 5: Stateless Tool Routing (Load Balanced)
// ===================================================================

async function routeStatelessTool(request: Request, env: Env): Promise<Response> {
  // Option A: Single global DO (simple, good for <1000 req/sec)
  const doId = env.FLOW_EXECUTOR.idFromName('global');
  
  // Option B: Load balance across shards (better for high traffic)
  // const shardCount = 100;
  // const shard = Math.floor(Math.random() * shardCount);
  // const doId = env.FLOW_EXECUTOR.idFromName(`shard:${shard}`);
  
  const doStub = env.FLOW_EXECUTOR.get(doId);
  
  return doStub.fetch(addHeaders(request, {
    'X-Sharding-Type': 'global'
  }));
}

// ===================================================================
// Fallback: Route by Flow Config
// ===================================================================

async function routeByFlowConfig(request: Request, env: Env): Promise<Response> {
  // Quick route lookup to determine sharding
  if (!env.DB) {
    return new Response(JSON.stringify({ 
      error: 'Database not configured'
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');
  const method = request.method.toUpperCase();
  
  const route = await env.DB.prepare(`
    SELECT sharding_type FROM http_routes
    WHERE path = ? AND method = ?
    LIMIT 1
  `).bind(path, method).first();
  
  if (!route) {
    return new Response(JSON.stringify({ 
      error: 'Route not found'
    }), { 
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Route based on configured sharding type
  const shardingType = (route.sharding_type as string) || 'global';
  
  switch (shardingType) {
    case 'session':
      return routeBySession(request, env);
    case 'user':
      return routeByUser(request, env);
    case 'job':
      return routeByJob(request, env);
    case 'workspace':
      return routeByWorkspace(request, env);
    default:
      return routeStatelessTool(request, env);
  }
}

// ===================================================================
// Helper Functions
// ===================================================================

function addHeaders(request: Request, headers: Record<string, string>): Request {
  return new Request(request.url, {
    method: request.method,
    headers: {
      ...Object.fromEntries(request.headers),
      ...headers
    },
    body: request.body
  });
}

function addResponseHeaders(response: Response, headers: Record<string, string>): Response {
  return new Response(response.body, {
    status: response.status,
    headers: {
      ...Object.fromEntries(response.headers),
      ...headers
    }
  });
}

async function extractUserIdFromAuth(request: Request): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader) {
    return null;
  }
  
  // Example: "Bearer {token}"
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    // In production, validate JWT and extract user ID
    // For now, just use the token as user ID
    return token;
  }
  
  return null;
}

// ===================================================================
// FlowExecutorDO.ts - Unified DO Handling All Patterns
// ===================================================================

export class FlowExecutorDO extends DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private flowEngines: Map<string, any> = new Map();
  private shardingType?: string;
  
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
  }
  
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.shardingType = request.headers.get('X-Sharding-Type') || undefined;
    
    // Route based on sharding type
    switch (this.shardingType) {
      case 'session':
        return this.handleSessionRequest(request);
      
      case 'user':
        return this.handleUserRequest(request);
      
      case 'job':
        return this.handleJobRequest(request);
      
      case 'workspace':
        return this.handleWorkspaceRequest(request);
      
      case 'global':
      default:
        return this.handleStatelessRequest(request);
    }
  }
  
  // Session handling (chatbot pattern)
  private async handleSessionRequest(request: Request): Promise<Response> {
    // Load session context
    let context = await this.state.storage.get('session:context') || {
      messages: [],
      createdAt: new Date().toISOString()
    };
    
    // Execute flow with session context
    const result = await this.executeFlow(request, { _session: context });
    
    // Update session context
    if (result?._session) {
      await this.state.storage.put('session:context', result._session);
    }
    
    return this.formatResponse(result);
  }
  
  // User handling (user tools pattern)
  private async handleUserRequest(request: Request): Promise<Response> {
    const userId = request.headers.get('X-User-ID')!;
    
    // Check rate limits
    if (!await this.checkRateLimit(userId)) {
      return new Response(JSON.stringify({ 
        error: 'Rate limit exceeded'
      }), { 
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Execute flow
    const result = await this.executeFlow(request, { _userId: userId });
    
    // Update usage stats
    await this.updateUsageStats(userId);
    
    return this.formatResponse(result);
  }
  
  // Job handling (background job pattern)
  private async handleJobRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const jobId = request.headers.get('X-Job-ID')!;
    
    // Process job
    if (url.pathname.includes('/process')) {
      this.processJobInBackground(request, jobId);
      return new Response(JSON.stringify({ 
        started: true,
        jobId
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Get status
    if (url.pathname.includes('/status')) {
      const status = await this.state.storage.get('job:status');
      return new Response(JSON.stringify(status), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Get result
    if (url.pathname.includes('/result')) {
      const result = await this.state.storage.get('job:result');
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Not found', { status: 404 });
  }
  
  // Workspace handling (collaborative pattern)
  private async handleWorkspaceRequest(request: Request): Promise<Response> {
    // WebSocket for real-time collaboration
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }
    
    // Regular HTTP request
    const result = await this.executeFlow(request, {
      _workspaceId: request.headers.get('X-Workspace-ID')
    });
    
    return this.formatResponse(result);
  }
  
  // Stateless handling (one-shot tools)
  private async handleStatelessRequest(request: Request): Promise<Response> {
    // Simple execution, no state management
    const result = await this.executeFlow(request, {});
    return this.formatResponse(result);
  }
  
  // Core execution logic (simplified - implement based on your FlowEngine)
  private async executeFlow(request: Request, context: any): Promise<any> {
    // TODO: Implement actual flow execution
    // This is a placeholder
    return {
      success: true,
      context,
      result: 'Flow executed'
    };
  }
  
  private formatResponse(result: any): Response {
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Rate limiting
  private async checkRateLimit(userId: string): Promise<boolean> {
    const key = `ratelimit:${userId}`;
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 100;
    
    const data = await this.state.storage.get<any>(key) || { 
      count: 0, 
      resetAt: now + windowMs 
    };
    
    if (now > data.resetAt) {
      data.count = 0;
      data.resetAt = now + windowMs;
    }
    
    if (data.count >= maxRequests) {
      return false;
    }
    
    data.count++;
    await this.state.storage.put(key, data);
    
    return true;
  }
  
  // Usage tracking
  private async updateUsageStats(userId: string): Promise<void> {
    const stats = await this.state.storage.get<any>('usage:stats') || {
      totalRequests: 0,
      lastRequest: null
    };
    
    stats.totalRequests++;
    stats.lastRequest = new Date().toISOString();
    
    await this.state.storage.put('usage:stats', stats);
  }
  
  // Background job processing
  private async processJobInBackground(request: Request, jobId: string): Promise<void> {
    try {
      await this.state.storage.put('job:status', {
        state: 'processing',
        progress: 0,
        startedAt: Date.now()
      });
      
      // Simulate processing
      const data = await request.json();
      
      // Process in chunks
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await this.state.storage.put('job:status', {
          state: 'processing',
          progress: ((i + 1) / 10) * 100
        });
      }
      
      // Complete
      await this.state.storage.put('job:status', {
        state: 'completed',
        progress: 100,
        completedAt: Date.now()
      });
      
      await this.state.storage.put('job:result', {
        success: true,
        data: 'Job completed'
      });
      
    } catch (err: any) {
      await this.state.storage.put('job:status', {
        state: 'failed',
        error: err.message
      });
    }
  }
  
  // WebSocket handling
  private handleWebSocketUpgrade(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    this.state.acceptWebSocket(server);
    
    server.send(JSON.stringify({
      type: 'connected',
      message: 'WebSocket connected'
    }));
    
    return new Response(null, { status: 101, webSocket: client });
  }
}
