
// ===================================================================
// adminHandler.ts - Enhanced Admin Handler with Validation
// ===================================================================

import { Env, FlowConfig } from '../types/core';
import { D1_SCHEMA_STATEMENTS } from '../db/schema';
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
    
    // ===================================================================
    // Database Initialization
    // ===================================================================
    if (path === '/admin/init' && request.method === 'POST') {
      return await initializeDatabase(env);
    }
    
    // ===================================================================
    // Flow Management
    // ===================================================================
    if (path === '/admin/flows' && request.method === 'GET') {
      return await listFlows(env);
    }
    
    if (path.match(/^\/admin\/flows\/[^/]+$/) && request.method === 'GET') {
      const flowId = path.split('/').pop()!;
      return await getFlow(env, flowId);
    }
    
    if (path === '/admin/flows' && request.method === 'POST') {
      return await createFlow(env, request);
    }
    
    if (path.match(/^\/admin\/flows\/[^/]+$/) && request.method === 'PUT') {
      const flowId = path.split('/').pop()!;
      return await updateFlow(env, request, flowId);
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
    
    // ===================================================================
    // Flow Validation
    // ===================================================================
    if (path === '/admin/flows/validate' && request.method === 'POST') {
      return await validateFlowEndpoint(request);
    }
    
    // ===================================================================
    // DO Integration
    // ===================================================================
    if (path.match(/^\/admin\/flows\/[^/]+\/debug$/) && request.method === 'GET') {
      const flowId = path.split('/')[3];
      return await getFlowDebug(env, flowId);
    }
    
    if (path.match(/^\/admin\/flows\/[^/]+\/status$/) && request.method === 'GET') {
      const flowId = path.split('/')[3];
      return await getFlowStatus(env, flowId);
    }
    
    if (path.match(/^\/admin\/flows\/[^/]+\/clear-cache$/) && request.method === 'POST') {
      const flowId = path.split('/')[3];
      return await clearFlowCache(env, flowId);
    }
    
    // ===================================================================
    // Logs & Routes
    // ===================================================================
    if (path.match(/^\/admin\/flows\/[^/]+\/logs$/) && request.method === 'GET') {
      const flowId = path.split('/')[3];
      const limit = parseInt(url.searchParams.get('limit') || '50');
      return await getFlowLogs(env, flowId, limit);
    }
    
    if (path === '/admin/routes' && request.method === 'GET') {
      return await listRoutes(env);
    }
    
    // ===================================================================
    // Import/Export
    // ===================================================================
    if (path === '/admin/flows/import' && request.method === 'POST') {
      return await importFlows(env, request);
    }
    
    if (path === '/admin/flows/export' && request.method === 'GET') {
      return await exportFlows(env);
    }
    
    // ===================================================================
    // Stats
    // ===================================================================
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

async function getFlow(env: Env, flowId: string): Promise<Response> {
  try {
    const flow = await env.DB.prepare('SELECT * FROM flows WHERE id = ?').bind(flowId).first();
    
    if (!flow) {
      return jsonResponse({ error: 'Flow not found' }, corsHeaders, 404);
    }
    
    const routes = await env.DB.prepare(
      'SELECT * FROM http_routes WHERE flow_id = ?'
    ).bind(flowId).all();
    
    return jsonResponse({
      ...flow,
      config: JSON.parse(flow.config as string),
      routes: routes.results || []
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error fetching flow:', err);
    return jsonResponse({ 
      error: 'Failed to fetch flow',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function createFlow(env: Env, request: Request): Promise<Response> {
  try {
    const flowData = await request.json() as FlowConfig;
    const flowId = flowData.id || crypto.randomUUID();
    
    // Validate flow
    const validation = validateFlow(flowData);
    if (!validation.valid) {
      return jsonResponse({
        error: 'Flow validation failed',
        errors: validation.errors,
        warnings: validation.warnings
      }, corsHeaders, 400);
    }
    
    // Extract HTTP triggers
    const httpTriggers = extractHttpTriggers(flowData);
    flowData.httpTriggers = httpTriggers;
    
    // Use batch transaction
    const statements = [
      env.DB.prepare(`
        INSERT INTO flows (id, name, description, config, enabled)
        VALUES (?, ?, ?, ?, 1)
      `).bind(
        flowId,
        flowData.name,
        flowData.description || '',
        JSON.stringify({ ...flowData, id: flowId })
      ),
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
    
    await env.DB.batch(statements);
    
    return jsonResponse({ 
      success: true, 
      flowId,
      httpTriggers: httpTriggers.length,
      message: 'Flow created successfully',
      warnings: validation.warnings
    }, corsHeaders, 201);
  } catch (err: any) {
    console.error('Error creating flow:', err);
    return jsonResponse({ 
      error: 'Failed to create flow',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function updateFlow(env: Env, request: Request, flowId: string): Promise<Response> {
  try {
    const flowData = await request.json() as FlowConfig;
    
    // Validate flow
    const validation = validateFlow(flowData);
    if (!validation.valid) {
      return jsonResponse({
        error: 'Flow validation failed',
        errors: validation.errors,
        warnings: validation.warnings
      }, corsHeaders, 400);
    }
    
    // Extract HTTP triggers
    const httpTriggers = extractHttpTriggers(flowData);
    flowData.httpTriggers = httpTriggers;
    
    // Use batch transaction
    const statements = [
      env.DB.prepare(`
        UPDATE flows 
        SET name = ?, description = ?, config = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(
        flowData.name,
        flowData.description || '',
        JSON.stringify({ ...flowData, id: flowId }),
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
    
    // Clear DO cache
    if (env.FLOW_EXECUTOR) {
      const doId = env.FLOW_EXECUTOR.idFromName(`session:${flowId}`);
      const doStub = env.FLOW_EXECUTOR.get(doId);
      await doStub.fetch(new Request('http://do/internal/cache/clear'));
    }
    
    return jsonResponse({ 
      success: true, 
      message: 'Flow updated successfully',
      warnings: validation.warnings
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error updating flow:', err);
    return jsonResponse({ 
      error: 'Failed to update flow',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function deleteFlow(env: Env, flowId: string): Promise<Response> {
  try {
    const result = await env.DB.prepare('DELETE FROM flows WHERE id = ?').bind(flowId).run();
    
    if (result.meta.changes === 0) {
      return jsonResponse({ error: 'Flow not found' }, corsHeaders, 404);
    }
    
    // Clear DO cache
    if (env.FLOW_EXECUTOR) {
      const doId = env.FLOW_EXECUTOR.idFromName(`session:${flowId}`);
      const doStub = env.FLOW_EXECUTOR.get(doId);
      await doStub.fetch(new Request('http://do/internal/session/clear'));
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
// Validation
// ===================================================================

async function validateFlowEndpoint(request: Request): Promise<Response> {
  try {
    const flowData = await request.json() as FlowConfig;
    const validation = validateFlow(flowData);
    
    return jsonResponse({
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings
    }, corsHeaders);
  } catch (err: any) {
    return jsonResponse({
      error: 'Invalid flow data',
      details: err.message
    }, corsHeaders, 400);
  }
}

// ===================================================================
// DO Operations
// ===================================================================

async function getFlowDebug(env: Env, flowId: string): Promise<Response> {
  try {
    if (!env.FLOW_EXECUTOR) {
      return jsonResponse({ 
        error: 'Flow executor not configured'
      }, corsHeaders, 500);
    }
    
    const doId = env.FLOW_EXECUTOR.idFromName(`session:${flowId}`);
    const doStub = env.FLOW_EXECUTOR.get(doId);
    
    const response = await doStub.fetch(new Request('http://do/internal/debug/messages'));
    const data = await response.json();
    
    return jsonResponse(data, corsHeaders);
  } catch (err: any) {
    console.error('Error fetching debug messages:', err);
    return jsonResponse({ 
      error: 'Failed to fetch debug messages',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function getFlowStatus(env: Env, flowId: string): Promise<Response> {
  try {
    if (!env.FLOW_EXECUTOR) {
      return jsonResponse({ 
        error: 'Flow executor not configured'
      }, corsHeaders, 500);
    }
    
    const doId = env.FLOW_EXECUTOR.idFromName(`session:${flowId}`);
    const doStub = env.FLOW_EXECUTOR.get(doId);
    
    const response = await doStub.fetch(new Request('http://do/internal/status'));
    const data = await response.json();
    
    return jsonResponse(data, corsHeaders);
  } catch (err: any) {
    console.error('Error fetching flow status:', err);
    return jsonResponse({ 
      error: 'Failed to fetch flow status',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function clearFlowCache(env: Env, flowId: string): Promise<Response> {
  try {
    if (!env.FLOW_EXECUTOR) {
      return jsonResponse({ 
        error: 'Flow executor not configured'
      }, corsHeaders, 500);
    }
    
    const doId = env.FLOW_EXECUTOR.idFromName(`session:${flowId}`);
    const doStub = env.FLOW_EXECUTOR.get(doId);
    
    const response = await doStub.fetch(new Request('http://do/internal/cache/clear'));
    const data = await response.json();
    
    return jsonResponse(data, corsHeaders);
  } catch (err: any) {
    console.error('Error clearing cache:', err);
    return jsonResponse({ 
      error: 'Failed to clear cache',
      details: err.message
    }, corsHeaders, 500);
  }
}

// ===================================================================
// Logs & Stats
// ===================================================================

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

async function listRoutes(env: Env): Promise<Response> {
  try {
    const routes = await env.DB.prepare(`
      SELECT r.*, f.name as flow_name 
      FROM http_routes r
      JOIN flows f ON f.id = r.flow_id
      WHERE r.enabled = 1
      ORDER BY r.path, r.method
    `).all();
    
    return jsonResponse({ 
      routes: routes.results || [], 
      count: routes.results?.length || 0 
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error fetching routes:', err);
    return jsonResponse({ 
      error: 'Failed to fetch routes',
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
// Import/Export
// ===================================================================

async function importFlows(env: Env, request: Request): Promise<Response> {
  try {
    const { flows } = await request.json() as { flows: FlowConfig[] };
    const results = [];
    
    for (const flowData of flows) {
      try {
        // Validate
        const validation = validateFlow(flowData);
        if (!validation.valid) {
          results.push({ 
            flowId: flowData.id, 
            success: false, 
            error: validation.errors.join('; ') 
          });
          continue;
        }
        
        const flowId = flowData.id || crypto.randomUUID();
        const httpTriggers = extractHttpTriggers(flowData);
        flowData.httpTriggers = httpTriggers;
        
        const statements = [
          env.DB.prepare(`
            INSERT OR REPLACE INTO flows (id, name, description, config, enabled)
            VALUES (?, ?, ?, ?, 1)
          `).bind(
            flowId,
            flowData.name,
            flowData.description || '',
            JSON.stringify({ ...flowData, id: flowId })
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
        
        await env.DB.batch(statements);
        results.push({ flowId, success: true, routes: httpTriggers.length });
      } catch (err: any) {
        results.push({ flowId: flowData.id, success: false, error: err.message });
      }
    }
    
    return jsonResponse({ 
      results,
      imported: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error importing flows:', err);
    return jsonResponse({ 
      error: 'Failed to import flows',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function exportFlows(env: Env): Promise<Response> {
  try {
    const flows = await env.DB.prepare('SELECT config FROM flows WHERE enabled = 1').all();
    const exportData = flows.results?.map(f => JSON.parse(f.config as string)) || [];
    
    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="flows-export.json"',
        ...corsHeaders
      }
    });
  } catch (err: any) {
    console.error('Error exporting flows:', err);
    return jsonResponse({ 
      error: 'Failed to export flows',
      details: err.message
    }, corsHeaders, 500);
  }
}

// ===================================================================
// Helper Functions
// ===================================================================

function extractHttpTriggers(flowData: FlowConfig): Array<{
  nodeId: string;
  path: string;
  method: string;
}> {
  const triggers: Array<{ nodeId: string; path: string; method: string }> = [];
  
  for (const node of flowData.nodes) {
    if (node.type === 'http-in' && node.url) {
      triggers.push({
        nodeId: node.id,
        path: node.url,
        method: (node.method || 'get').toUpperCase()
      });
    }
  }
  
  return triggers;
}
