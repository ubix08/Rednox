
// ===================================================================
// RedNox - Main Worker Entry Point
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
    
    // Admin endpoints
    if (path.startsWith('/admin/')) {
      return handleAdmin(request, env);
    }
    
    // API endpoints - Fast route lookup
    if (path.startsWith('/api/')) {
      return handleApiRoute(request, env, path.replace('/api', ''));
    }
    
    // Info endpoint
    return new Response(JSON.stringify({
      name: 'RedNox - Optimized Node-RED Worker',
      version: '2.0.0',
      endpoints: {
        admin: '/admin/flows',
        api: '/api/{path}'
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
