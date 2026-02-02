// ===================================================================
// index.ts - Worker Entry Point
// ===================================================================

import { Env } from './types/core';
import { handleAdmin } from './handlers/adminHandler';

// Import all standard nodes
import './nodes/nodes';

// Import all AI agent system nodes
import './nodes/ai/index';

// Export the Durable Object
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
        version: '3.1.0',
        description: 'RedNox - Universal LLM Agent System',
        timestamp: new Date().toISOString(),
        features: [
          'Multi-provider LLM support (OpenAI, Anthropic, Gemini, Groq)',
          'Function calling / Tool use',
          'Conversation memory',
          'HTTP-based tools',
          'Code-based tools',
          'Persistent context storage',
          'Debug execution with traces',
        ]
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
      version: '3.1.0',
      description: 'Universal LLM Agent Flow Execution Runtime',
      
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
        'Multi-provider LLM support (OpenAI, Anthropic, Gemini, Groq)',
        'Universal agent with tool calling',
        'Function-based tools',
        'HTTP-based tools',
        'Conversation memory',
        'Persistent context storage (D1)',
        'Ephemeral execution',
        'HTTP webhooks (multiple per flow)',
        'Scheduled execution (inject nodes)',
        'Context storage (flow/global scope)',
        'Standard Node-RED nodes',
        'Debug execution with traces'
      ],
      
      aiNodes: {
        'llm-config': 'Centralized LLM configuration',
        'llm-agent': 'Universal agent with tool calling',
        'llm-stream': 'Real-time streaming responses',
        'memory': 'Conversation memory management',
        'function-tool': 'Code-based tool wrapper',
        'http-tool': 'API-based tool wrapper'
      },
      
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
          stats: 'GET /admin/stats',
          nodes: 'GET /admin/nodes',
          debugExecute: 'POST /admin/flows/{id}/debug-execute',
          contextManagement: {
            getConversations: 'GET /admin/flows/{id}/conversations',
            getContexts: 'GET /admin/flows/{id}/contexts/{conversationId}',
            deleteConversation: 'DELETE /admin/flows/{id}/contexts/{conversationId}',
            getFlowContext: 'GET /admin/flows/{id}/context',
            setFlowContext: 'POST /admin/flows/{id}/context',
            deleteContextKey: 'DELETE /admin/flows/{id}/context/{key}',
            getStats: 'GET /admin/flows/{id}/context-stats',
            cleanup: 'POST /admin/contexts/cleanup',
            globalContext: {
              get: 'GET /admin/global-context',
              set: 'POST /admin/global-context',
              delete: 'DELETE /admin/global-context/{key}'
            }
          }
        },
        flows: {
          pattern: 'POST /api/{flow-id}/{endpoint}',
          description: 'Execute flow via HTTP trigger'
        }
      },
      
      standardNodes: [
        'http-in', 'http-response', 'http-request',
        'inject', 'function', 'context', 'memory',
        'switch', 'change',
        'json', 'csv', 'xml',
        'delay', 'split', 'join', 'sort', 'batch',
        'debug', 'catch', 'status', 'complete',
        'template', 'range', 'trigger',
        'comment', 'link-in', 'link-out',
        'llm-config', 'llm-agent', 'llm-stream',
        'function-tool', 'http-tool'
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
