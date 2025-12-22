
// ===================================================================
// RedNox - API Route Handler (Corrected)
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
  let flowId = 'unknown';
  
  try {
    // Check if DB is configured
    if (!env.DB) {
      return new Response(JSON.stringify({ 
        error: 'Database not configured',
        hint: 'Make sure D1 database is bound in wrangler.toml'
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
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
    
    flowId = route.flow_id as string;
    const flowConfig: FlowConfig = JSON.parse(route.config as string);
    
    // Check if FLOW_EXECUTOR is configured
    if (!env.FLOW_EXECUTOR) {
      const duration = Date.now() - startTime;
      await logExecution(env, flowId, 'error', duration, 'Durable Object not configured');
      
      return new Response(JSON.stringify({ 
        error: 'Flow executor not configured',
        hint: 'Make sure Durable Object binding is configured in wrangler.toml'
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Get DO stub using RPC
    const doId = env.FLOW_EXECUTOR.idFromName(flowId);
    const doStub = env.FLOW_EXECUTOR.get(doId);
    
    // Load flow configuration (cached in DO)
    await doStub.loadFlow(flowConfig);
    
    // Parse request payload
    const payload = await parseRequestPayload(request, triggerPath);
    
    // Execute flow via RPC
    const result = await doStub.executeFlow(route.node_id as string, payload);
    
    // Log execution (async, don't wait)
    const duration = Date.now() - startTime;
    await logExecution(env, flowId, 'success', duration);
    
    // Return response
    return new Response(result.body, {
      status: result.statusCode,
      headers: result.headers
    });
    
  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.error('API route error:', err);
    
    await logExecution(env, flowId, 'error', duration, err.message);
    
    return new Response(JSON.stringify({ 
      error: err.message,
      stack: err.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function logExecution(
  env: Env,
  flowId: string,
  status: string,
  duration: number,
  errorMessage?: string
): Promise<void> {
  // Fire and forget - don't block response
  try {
    if (!env.DB) {
      console.warn('Cannot log execution: DB not configured');
      return;
    }
    
    await env.DB.prepare(`
      INSERT INTO flow_logs (flow_id, status, duration_ms, error_message) 
      VALUES (?, ?, ?, ?)
    `).bind(flowId, status, duration, errorMessage || null).run();
  } catch (err: any) {
    console.error('Failed to log execution:', err);
  }
}
