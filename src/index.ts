// src/worker.ts
import { FlowExecutorDO } from './do/FlowExecutorDO';
import { handleAdmin } from './handlers/adminHandler';
import { handleApiRoute } from './handlers/apiHandler';

export { FlowExecutorDO };
export interface Env {
  DB: D1Database;
  FLOW_EXECUTOR: DurableObjectNamespace<FlowExecutorDO>;
}

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
