
// ===================================================================
// RedNox - Optimized Worker Entry (CPU Budget Conscious)
// ===================================================================

import { Env } from './types/core';
import { handleAdmin } from './handlers/adminHandler';
import { handleApiRoute } from './handlers/apiHandler';

// Import nodes to register them
import './nodes';

// Export Durable Object
export { FlowExecutorDO } from './durable-objects/FlowExecutorDO';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Quick CORS preflight handling (minimize CPU)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }
    
    // Admin endpoints - these run in worker context
    if (path.startsWith('/admin/')) {
      return handleAdmin(request, env);
    }
    
    // API endpoints - immediately delegate to DO
    // Worker only does route lookup, execution happens in DO
    if (path.startsWith('/api/')) {
      return handleApiRoute(request, env, path.replace('/api', ''));
    }
    
    // Health check - minimal CPU
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
