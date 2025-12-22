// ===================================================================
// RedNox - API Route Handler
// ===================================================================

import { Env, FlowConfig } from '../types/core';
import { parseRequestPayload } from '../utils';

export async function handleApiRoute(
  request: Request,
  env: Env,
  triggerPath: string
): Promise<Response> {
  const method = request.method.toUpperCase();
  const startTime = Date.now();
  
  try {
    // Fast route lookup using indexed query
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
    
    const flowConfig: FlowConfig = JSON.parse(route.config as string);
    
    // Get DO stub using RPC
    const doId = env.FLOW_EXECUTOR.idFromName(route.flow_id as string);
    const doStub = env.FLOW_EXECUTOR.get(doId);
    
    // Load flow configuration (cached in DO)
    await doStub.loadFlow(flowConfig);
    
    // Parse request payload
    const payload = await parseRequestPayload(request, triggerPath);
    
    // Execute flow via RPC
    const result = await doStub.executeFlow(route.node_id as string, payload);
    
    // Log execution (async, don't wait)
    const duration = Date.now() - startTime;
    logExecution(env, route.flow_id as string, 'success', duration);
    
    // Return response
    return new Response(result.body, {
      status: result.statusCode,
      headers: result.headers
    });
    
  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.error('API route error:', err);
    
    logExecution(env, 'unknown', 'error', duration, err.message);
    
    return new Response(JSON.stringify({ 
      error: err.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function logExecution(
  env: Env,
  flowId: string,
  status: string,
  duration: number,
  errorMessage?: string
): void {
  // Fire and forget - don't block response
  env.DB.prepare(`
    INSERT INTO flow_logs (flow_id, status, duration_ms, error_message) 
    VALUES (?, ?, ?, ?)
  `).bind(flowId, status, duration, errorMessage || null).run().catch(() => {});
}
