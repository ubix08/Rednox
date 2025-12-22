
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

