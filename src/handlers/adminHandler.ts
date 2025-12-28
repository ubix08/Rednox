
// ===================================================================
// adminHandler.ts - Flow Management (FIXED)
// ===================================================================

import { Env, FlowConfig, D1_SCHEMA_STATEMENTS } from '../types/core';
import { jsonResponse, validateFlow } from '../utils';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    if (!env.DB) {
      return jsonResponse({ 
        error: 'Database not configured',
        hint: 'Make sure D1 database is bound in wrangler.toml'
      }, corsHeaders, 500);
    }
    
    // Database Initialization
    if (path === '/admin/init' && request.method === 'POST') {
      return await initializeDatabase(env);
    }
    
    // Flow Management
    if (path === '/admin/flows' && request.method === 'GET') {
      return await listFlows(env);
    }
    
    if (path.match(/^\/admin\/flows\/[^/]+$/) && request.method === 'GET') {
      const flowId = path.split('/').pop()!;
      return await getFlow(env, flowId, url.origin);
    }
    
    if (path === '/admin/flows' && request.method === 'POST') {
      return await createFlow(env, request, url.origin);
    }
    
    if (path.match(/^\/admin\/flows\/[^/]+$/) && request.method === 'PUT') {
      const flowId = path.split('/').pop()!;
      return await updateFlow(env, request, flowId, url.origin);
    }
    
    if (path.match(/^\/admin\/flows\/[^/]+$/) && request.method === 'DELETE') {
      const flowId = path.split('/').pop()!;
      return await deleteFlow(env, flowId);
    }
    
    if (path.match(/^\/admin\/flows\/[^/]+\/(enable|disable)$/) && request.method === 'POST') {
      const parts = path.split('/');
      const flowId = parts[parts.length - 2];
      const action = parts[parts.length - 1];
      return await toggleFlow(env, flowId, action === 'enable');
    }
    
    // Routes
    if (path === '/admin/routes' && request.method === 'GET') {
      return await listRoutes(env, url.origin);
    }
    
    // Logs
    if (path.match(/^\/admin\/flows\/[^/]+\/logs$/) && request.method === 'GET') {
      const flowId = path.split('/')[3];
      const limit = parseInt(url.searchParams.get('limit') || '50');
      return await getFlowLogs(env, flowId, limit);
    }
    
    // Stats
    if (path === '/admin/stats' && request.method === 'GET') {
      return await getStats(env);
    }
    
    return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
    
  } catch (err: any) {
    console.error('Admin error:', err);
    return jsonResponse({ 
      error: 'Internal server error',
      details: err.message,
      stack: err.stack
    }, corsHeaders, 500);
  }
}

// ===================================================================
// Database Operations
// ===================================================================

async function initializeDatabase(env: Env): Promise<Response> {
  try {
    console.log('Starting database initialization...');
    
    const results = [];
    for (const statement of D1_SCHEMA_STATEMENTS) {
      try {
        console.log('Executing:', statement.substring(0, 50) + '...');
        const result = await env.DB.prepare(statement).run();
        results.push({ 
          statement: statement.substring(0, 50),
          success: true,
          meta: result.meta 
        });
      } catch (stmtErr: any) {
        console.error('Statement error:', stmtErr);
        results.push({ 
          statement: statement.substring(0, 50),
          success: false,
          error: stmtErr.message 
        });
      }
    }
    
    const failed = results.filter(r => !r.success);
    
    if (failed.length > 0) {
      return jsonResponse({ 
        error: 'Database initialization partially failed',
        results,
        failed: failed.length,
        details: failed.map(f => f.error).join('; ')
      }, corsHeaders, 500);
    }
    
    return jsonResponse({ 
      success: true, 
      message: 'Database initialized successfully',
      statements: results.length
    }, corsHeaders);
  } catch (err: any) {
    console.error('Database initialization error:', err);
    return jsonResponse({ 
      error: 'Database initialization failed',
      details: err.message,
      stack: err.stack
    }, corsHeaders, 500);
  }
}

// ===================================================================
// Flow CRUD Operations
// ===================================================================

async function listFlows(env: Env): Promise<Response> {
  try {
    const flows = await env.DB.prepare(
      'SELECT id, name, description, enabled, created_at, updated_at FROM flows ORDER BY created_at DESC'
    ).all();
    
    return jsonResponse({ 
      flows: flows.results || [], 
      count: flows.results?.length || 0 
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error fetching flows:', err);
    return jsonResponse({ 
      error: 'Failed to fetch flows',
      details: err.message,
      hint: 'Database might not be initialized. Call POST /admin/init first'
    }, corsHeaders, 500);
  }
}

async function getFlow(env: Env, flowId: string, origin: string): Promise<Response> {
  try {
    const flow = await env.DB.prepare('SELECT * FROM flows WHERE id = ?').bind(flowId).first();
    
    if (!flow) {
      return jsonResponse({ error: 'Flow not found' }, corsHeaders, 404);
    }
    
    const routes = await env.DB.prepare(
      'SELECT * FROM http_routes WHERE flow_id = ?'
    ).bind(flowId).all();
    
    const routesWithUrls = (routes.results || []).map(route => ({
      ...route,
      fullUrl: `${origin}/api${route.path}`
    }));
    
    return jsonResponse({
      ...flow,
      config: JSON.parse(flow.config as string),
      routes: routesWithUrls
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error fetching flow:', err);
    return jsonResponse({ 
      error: 'Failed to fetch flow',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function createFlow(env: Env, request: Request, origin: string): Promise<Response> {
  try {
    const requestData = await request.json();
    
    // The frontend sends the full flow config in the request body
    // Extract metadata and ensure proper structure
    const flowConfig: FlowConfig = {
      id: requestData.id || crypto.randomUUID(),
      name: requestData.name || 'Unnamed Flow',
      description: requestData.description,
      version: requestData.version,
      nodes: requestData.nodes || []
    };
    
    // Validate flow structure
    const validation = validateFlow(flowConfig);
    if (!validation.valid) {
      return jsonResponse({
        error: 'Flow validation failed',
        errors: validation.errors,
        warnings: validation.warnings
      }, corsHeaders, 400);
    }
    
    // Extract HTTP triggers
    const httpTriggers = extractHttpTriggers(flowConfig, flowConfig.id);
    
    // Store in database
    const statements = [
      env.DB.prepare(`
        INSERT INTO flows (id, name, description, config, enabled)
        VALUES (?, ?, ?, ?, 1)
      `).bind(
        flowConfig.id,
        flowConfig.name,
        flowConfig.description || '',
        JSON.stringify(flowConfig)  // Store the complete config
      ),
      ...httpTriggers.map(trigger => 
        env.DB.prepare(`
          INSERT INTO http_routes (id, flow_id, node_id, path, method, enabled)
          VALUES (?, ?, ?, ?, ?, 1)
        `).bind(
          crypto.randomUUID(),
          flowConfig.id,
          trigger.nodeId,
          trigger.path,
          trigger.method
        )
      )
    ];
    
    await env.DB.batch(statements);
    
    return jsonResponse({ 
      success: true, 
      flowId: flowConfig.id,
      httpTriggers: httpTriggers.length,
      endpoints: httpTriggers.map(t => ({
        method: t.method,
        path: t.path,
        url: `${origin}/api${t.path}`,
        nodeId: t.nodeId
      })),
      message: 'Flow created successfully',
      warnings: validation.warnings
    }, corsHeaders, 201);
  } catch (err: any) {
    console.error('Error creating flow:', err);
    return jsonResponse({ 
      error: 'Failed to create flow',
      details: err.message,
      stack: err.stack
    }, corsHeaders, 500);
  }
}

async function updateFlow(env: Env, request: Request, flowId: string, origin: string): Promise<Response> {
  try {
    const requestData = await request.json();
    
    // Build flow config from request data
    const flowConfig: FlowConfig = {
      id: flowId,  // Use the flowId from the URL
      name: requestData.name || 'Unnamed Flow',
      description: requestData.description,
      version: requestData.version,
      nodes: requestData.nodes || []
    };
    
    // Validate flow
    const validation = validateFlow(flowConfig);
    if (!validation.valid) {
      return jsonResponse({
        error: 'Flow validation failed',
        errors: validation.errors,
        warnings: validation.warnings
      }, corsHeaders, 400);
    }
    
    // Extract HTTP triggers
    const httpTriggers = extractHttpTriggers(flowConfig, flowId);
    
    // Use batch transaction
    const statements = [
      env.DB.prepare(`
        UPDATE flows 
        SET name = ?, description = ?, config = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(
        flowConfig.name,
        flowConfig.description || '',
        JSON.stringify(flowConfig),
        flowId
      ),
      env.DB.prepare('DELETE FROM http_routes WHERE flow_id = ?').bind(flowId),
      ...httpTriggers.map(trigger => 
        env.DB.prepare(`
          INSERT INTO http_routes (id, flow_id, node_id, path, method, enabled)
          VALUES (?, ?, ?, ?, ?, 1)
        `).bind(
          crypto.randomUUID(),
          flowId,
          trigger.nodeId,
          trigger.path,
          trigger.method
        )
      )
    ];
    
    const results = await env.DB.batch(statements);
    
    if (results[0].meta.changes === 0) {
      return jsonResponse({ error: 'Flow not found' }, corsHeaders, 404);
    }
    
    return jsonResponse({ 
      success: true, 
      message: 'Flow updated successfully',
      endpoints: httpTriggers.map(t => ({
        method: t.method,
        path: t.path,
        url: `${origin}/api${t.path}`,
        nodeId: t.nodeId
      })),
      warnings: validation.warnings
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error updating flow:', err);
    return jsonResponse({ 
      error: 'Failed to update flow',
      details: err.message,
      stack: err.stack
    }, corsHeaders, 500);
  }
}

async function deleteFlow(env: Env, flowId: string): Promise<Response> {
  try {
    const result = await env.DB.prepare('DELETE FROM flows WHERE id = ?').bind(flowId).run();
    
    if (result.meta.changes === 0) {
      return jsonResponse({ error: 'Flow not found' }, corsHeaders, 404);
    }
    
    return jsonResponse({ 
      success: true, 
      message: 'Flow deleted successfully' 
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error deleting flow:', err);
    return jsonResponse({ 
      error: 'Failed to delete flow',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function toggleFlow(env: Env, flowId: string, enable: boolean): Promise<Response> {
  try {
    const enabled = enable ? 1 : 0;
    
    const statements = [
      env.DB.prepare(
        'UPDATE flows SET enabled = ?, updated_at = datetime(\'now\') WHERE id = ?'
      ).bind(enabled, flowId),
      env.DB.prepare(
        'UPDATE http_routes SET enabled = ? WHERE flow_id = ?'
      ).bind(enabled, flowId)
    ];
    
    await env.DB.batch(statements);
    
    return jsonResponse({ 
      success: true, 
      enabled: enable,
      message: `Flow ${enable ? 'enabled' : 'disabled'} successfully`
    }, corsHeaders);
  } catch (err: any) {
    console.error(`Error toggling flow:`, err);
    return jsonResponse({ 
      error: `Failed to ${enable ? 'enable' : 'disable'} flow`,
      details: err.message
    }, corsHeaders, 500);
  }
}

// ===================================================================
// Routes & Stats
// ===================================================================

async function listRoutes(env: Env, origin: string): Promise<Response> {
  try {
    const routes = await env.DB.prepare(`
      SELECT r.*, f.name as flow_name 
      FROM http_routes r
      JOIN flows f ON f.id = r.flow_id
      WHERE r.enabled = 1
      ORDER BY r.path, r.method
    `).all();
    
    const routesWithUrls = (routes.results || []).map(route => ({
      ...route,
      fullUrl: `${origin}/api${route.path}`
    }));
    
    return jsonResponse({ 
      routes: routesWithUrls, 
      count: routesWithUrls.length 
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error fetching routes:', err);
    return jsonResponse({ 
      error: 'Failed to fetch routes',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function getFlowLogs(env: Env, flowId: string, limit: number): Promise<Response> {
  try {
    const logs = await env.DB.prepare(
      'SELECT * FROM flow_logs WHERE flow_id = ? ORDER BY executed_at DESC LIMIT ?'
    ).bind(flowId, limit).all();
    
    return jsonResponse({ logs: logs.results || [] }, corsHeaders);
  } catch (err: any) {
    console.error('Error fetching logs:', err);
    return jsonResponse({ 
      error: 'Failed to fetch logs',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function getStats(env: Env): Promise<Response> {
  try {
    const [flowCount, routeCount, logCount] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as count FROM flows').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM http_routes WHERE enabled = 1').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM flow_logs').first()
    ]);
    
    return jsonResponse({
      flows: flowCount?.count || 0,
      routes: routeCount?.count || 0,
      logs: logCount?.count || 0
    }, corsHeaders);
  } catch (err: any) {
    return jsonResponse({
      error: 'Failed to fetch stats',
      details: err.message
    }, corsHeaders, 500);
  }
}

// ===================================================================
// Helper Functions
// ===================================================================

function extractHttpTriggers(flowData: FlowConfig, flowId: string): Array<{
  nodeId: string;
  path: string;
  method: string;
}> {
  const triggers: Array<{ nodeId: string; path: string; method: string }> = [];
  
  for (const node of flowData.nodes) {
    if (node.type === 'http-in' && node.url) {
      let nodePath = node.url;
      if (!nodePath.startsWith('/')) {
        nodePath = '/' + nodePath;
      }
      
      // Path format: /{flow-id}{endpoint}
      const fullPath = `/${flowId}${nodePath}`;
      
      triggers.push({
        nodeId: node.id,
        path: fullPath,
        method: (node.method || 'post').toUpperCase()
      });
    }
  }
  
  return triggers;
}
