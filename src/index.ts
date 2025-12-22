
// ===================================================================
// index.ts - MINIMAL Worker (Just Routes to DO)
// ===================================================================

import { Env } from './types/core';
import { handleAdmin } from './handlers/adminHandler';

// Import nodes to register them
import './nodes';

// Export Durable Object
export { FlowExecutorDO } from './durable-objects/FlowExecutorDO';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }
    
    // Admin endpoints (still handled in worker for simplicity)
    if (path.startsWith('/admin/')) {
      return handleAdmin(request, env);
    }
    
    // API endpoints - IMMEDIATELY DELEGATE TO DO
    if (path.startsWith('/api/')) {
      if (!env.FLOW_EXECUTOR) {
        return new Response(JSON.stringify({ 
          error: 'Flow executor not configured'
        }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Use a single global DO instance (or shard by path if needed)
      const doId = env.FLOW_EXECUTOR.idFromName('global');
      const doStub = env.FLOW_EXECUTOR.get(doId);
      
      // Forward entire request to DO - it handles everything
      return doStub.fetch(request);
    }
    
    // Health check
    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Info endpoint
    return new Response(JSON.stringify({
      name: 'RedNox',
      version: '2.0.0',
      endpoints: {
        admin: '/admin/flows',
        api: '/api/{path}',
        health: '/health'
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
