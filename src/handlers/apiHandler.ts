
// ===================================================================
// RedNox - API Handler (Optimized for <10ms Worker CPU)
// ===================================================================

import { Env, FlowConfig } from '../types/core';
import { parseRequestPayload } from '../utils';

export async function handleApiRoute(
  request: Request,
  env: Env,
  triggerPath: string
): Promise<Response> {
  const method = request.method.toUpperCase();
  
  try {
    // CRITICAL: Minimize worker CPU time - only do route lookup
    if (!env.DB) {
      return new Response(JSON.stringify({ 
        error: 'Database not configured'
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Fast indexed lookup (~2ms)
    const route = await env.DB.prepare(`
      SELECT r.flow_id, r.node_id, f.config 
      FROM http_routes r
      JOIN flows f ON f.id = r.flow_id
      WHERE r.path = ? AND r.method = ? AND r.enabled = 1 AND f.enabled = 1
      LIMIT 1
    `).bind(triggerPath, method).first();
    
    if (!route) {
      return new Response(JSON.stringify({ 
        error: 'Route not found',
        path: triggerPath,
        method 
      }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (!env.FLOW_EXECUTOR) {
      return new Response(JSON.stringify({ 
        error: 'Flow executor not configured'
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const flowId = route.flow_id as string;
    const flowConfig: FlowConfig = JSON.parse(route.config as string);
    
    // IMPORTANT: Get DO stub and immediately delegate
    // This keeps worker CPU minimal
    const doId = env.FLOW_EXECUTOR.idFromName(flowId);
    const doStub = env.FLOW_EXECUTOR.get(doId);
    
    // Parse request (lightweight operation)
    const payload = await parseRequestPayload(request, triggerPath);
    
    // DELEGATE TO DO: All heavy lifting happens here (30s budget)
    // The DO will:
    // 1. Load/cache the flow if needed
    // 2. Execute all nodes
    // 3. Handle async operations
    // 4. Log results
    const result = await doStub.executeFlow(
      flowConfig,
      route.node_id as string,
      payload
    );
    
    // Worker just returns the response (minimal CPU)
    return new Response(result.body, {
      status: result.statusCode,
      headers: result.headers
    });
    
  } catch (err: any) {
    console.error('API route error:', err);
    
    return new Response(JSON.stringify({ 
      error: err.message,
      hint: 'Check worker logs for details'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
