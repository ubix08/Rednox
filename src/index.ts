
// ===================================================================
// index.ts - Worker Entry Point
// ===================================================================

import { Env } from './types/core';
import { handleAdmin } from './handlers/adminHandler';

// Import all nodes
import './nodes/nodes';
//import './nodes/gemini-nodes';

// Export the DO
export { FlowExecutorDO } from './durable-objects/FlowExecutorDO';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Session-ID, X-User-ID, X-Flow-ID, Authorization',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // Admin endpoints
    if (path.startsWith('/admin/')) {
      return handleAdmin(request, env);
    }
    
    // Health check
    if (path === '/health') {
      return new Response(JSON.stringify({ 
        status: 'ok',
        version: '3.0.0',
        description: 'Pure Node-RED Compatible Runtime',
        timestamp: new Date().toISOString()
      }), {
        headers: { 
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    
    // API routing - All flow requests go through /api/{flow-id}/{endpoint}
    if (path.startsWith('/api/')) {
      return routeFlowRequest(request, env);
    }
    
    // Root info
    return new Response(JSON.stringify({
      name: 'RedNox',
      version: '3.0.0',
      description: 'Pure Node-RED Compatible Flow Execution Runtime',
      
      routing: {
        pattern: '/api/{flow-id}/{endpoint}',
        description: 'Each flow has its own namespace',
        examples: [
          '/api/my-chatbot/chat',
          '/api/my-chatbot/reset',
          '/api/my-api/users',
          '/api/webhook-handler/payment'
        ]
      },
      
      features: [
        'Pure Node-RED compatibility',
        'Ephemeral execution (no state retention)',
        'HTTP webhooks (multiple per flow)',
        'Scheduled execution (inject nodes)',
        'Context storage (flow/global scope)',
        'Standard Node-RED nodes',
        'No templates - all flows stored in D1',
        'No hardcoded sessions/AI - use function nodes'
      ],
      
      quickStart: {
        step1: 'Initialize database: POST /admin/init',
        step2: 'Create flow with JSON: POST /admin/flows',
        step3: 'Use endpoint: POST /api/{flow-id}/{endpoint}'
      },
      
      endpoints: {
        admin: {
          init: 'POST /admin/init',
          listFlows: 'GET /admin/flows',
          createFlow: 'POST /admin/flows',
          getFlow: 'GET /admin/flows/{id}',
          updateFlow: 'PUT /admin/flows/{id}',
          deleteFlow: 'DELETE /admin/flows/{id}',
          toggleFlow: 'POST /admin/flows/{id}/{enable|disable}',
          routes: 'GET /admin/routes',
          logs: 'GET /admin/flows/{id}/logs',
          stats: 'GET /admin/stats'
        },
        flows: {
          pattern: 'POST /api/{flow-id}/{endpoint}',
          description: 'Execute flow via HTTP trigger'
        }
      },
      
      standardNodes: [
        'http-in', 'http-response',
        'inject', 'function', 'context',
        'switch', 'change',
        'json', 'delay', 'split', 'join',
        'debug', 'catch', 'status'
      ]
    }, null, 2), {
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
};

// ===================================================================
// Flow Request Routing
// ===================================================================

async function routeFlowRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');
  const method = request.method.toUpperCase();
  
  if (!env.FLOW_EXECUTOR) {
    return new Response(JSON.stringify({ 
      error: 'Flow executor not configured',
      hint: 'Make sure FLOW_EXECUTOR binding is configured in wrangler.toml'
    }), { 
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
  
  // Parse path: /{flow-id}/{endpoint}
  const pathParts = path.split('/').filter(p => p);
  
  if (pathParts.length < 1) {
    return new Response(JSON.stringify({ 
      error: 'Invalid path format',
      expected: '/api/{flow-id}/{endpoint}',
      received: path,
      hint: 'Flow ID is required in the path'
    }), { 
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
  
  // Extract flow-id from path
  const flowId = pathParts[0];
  
  // Route to DO (one DO per flow)
  const doId = env.FLOW_EXECUTOR.idFromName(`flow:${flowId}`);
  const doStub = env.FLOW_EXECUTOR.get(doId);
  
  // Forward request with metadata
  const modifiedRequest = new Request(request.url, {
    method: request.method,
    headers: {
      ...Object.fromEntries(request.headers),
      'X-Flow-ID': flowId
    },
    body: request.body
  });
  
  try {
    const response = await doStub.fetch(modifiedRequest);
    
    return new Response(response.body, {
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers),
        'X-Flow-ID': flowId,
        ...corsHeaders
      }
    });
  } catch (err: any) {
    console.error('[Worker] Flow request error:', err);
    return new Response(JSON.stringify({
      error: 'Flow execution failed',
      flowId,
      details: err.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-Flow-ID': flowId,
        ...corsHeaders
      }
    });
  }
}
