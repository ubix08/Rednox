
// ===================================================================
// adminHandler.ts - Complete Flow Management System
// ===================================================================

import { Env, FlowConfig, D1_SCHEMA_STATEMENTS } from '../types/core';
import { jsonResponse, validateFlow } from '../utils';
import { registry } from '../core/NodeRegistry';

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
    // ===================================================================
    // NODE DISCOVERY API
    // ===================================================================
    
    if (path === '/admin/nodes' && request.method === 'GET') {
      const discovery = registry.exportForUI();
      return jsonResponse(discovery, corsHeaders);
    }
    
    if (path === '/admin/nodes/categories' && request.method === 'GET') {
      const byCategory = registry.getByCategory();
      const categories = Array.from(byCategory.entries()).map(([name, nodes]) => ({
        name,
        count: nodes.length,
        nodes: nodes.map(n => ({
          type: n.type,
          label: n.ui.paletteLabel,
          icon: n.ui.icon,
          color: n.ui.color
        }))
      }));
      return jsonResponse({ 
        categories, 
        total: registry.list().length 
      }, corsHeaders);
    }
    
    if (path.match(/^\/admin\/nodes\/[^/]+$/) && request.method === 'GET') {
      const nodeType = path.split('/').pop()!;
      const definition = registry.get(nodeType);
      
      if (!definition) {
        return jsonResponse({ error: 'Node type not found' }, corsHeaders, 404);
      }
      
      return jsonResponse({
        type: definition.type,
        category: definition.category,
        inputs: definition.inputs,
        outputs: definition.outputs,
        defaults: definition.defaults,
        ui: definition.ui
      }, corsHeaders);
    }
    
    // ===================================================================
    // DATABASE & INITIALIZATION
    // ===================================================================
    
    if (!env.DB) {
      return jsonResponse({ 
        error: 'Database not configured',
        hint: 'Make sure D1 database is bound in wrangler.toml'
      }, corsHeaders, 500);
    }
    
    if (path === '/admin/init' && request.method === 'POST') {
      return await initializeDatabase(env);
    }
    
    // ===================================================================
    // FLOW MANAGEMENT
    // ===================================================================
    
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
    
    // ===================================================================
    // IMPORT/EXPORT
    // ===================================================================
    
    if (path.match(/^\/admin\/flows\/[^/]+\/export$/) && request.method === 'GET') {
      const flowId = path.split('/')[3];
      return await exportFlow(env, flowId);
    }
    
    if (path === '/admin/flows/import' && request.method === 'POST') {
      return await importFlow(env, request, url.origin);
    }
    
    // ===================================================================
    // FLOW EXECUTION
    // ===================================================================
    
    if (path.match(/^\/admin\/flows\/[^/]+\/execute$/) && request.method === 'POST') {
      const flowId = path.split('/')[3];
      return await executeFlowManually(env, flowId, request);
    }
    
    // ===================================================================
    // DEBUG & MONITORING
    // ===================================================================
    
    if (path.match(/^\/admin\/flows\/[^/]+\/debug$/) && request.method === 'GET') {
      const flowId = path.split('/')[3];
      const limit = parseInt(url.searchParams.get('limit') || '50');
      return await getDebugOutput(env, flowId, limit);
    }
    
    if (path.match(/^\/admin\/flows\/[^/]+\/logs$/) && request.method === 'GET') {
      const flowId = path.split('/')[3];
      const limit = parseInt(url.searchParams.get('limit') || '50');
      return await getFlowLogs(env, flowId, limit);
    }
    
    // ===================================================================
    // ROUTES & STATS
    // ===================================================================
    
    if (path === '/admin/routes' && request.method === 'GET') {
      return await listRoutes(env, url.origin);
    }
    
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
// DATABASE INITIALIZATION
// ===================================================================

async function initializeDatabase(env: Env): Promise<Response> {
  try {
    console.log('🔧 Starting database initialization...');
    
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
    
    // Create debug_output table
    try {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS debug_output (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          flow_id TEXT NOT NULL,
          node_id TEXT NOT NULL,
          message TEXT NOT NULL,
          type TEXT DEFAULT 'info',
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
        )
      `).run();
      
      await env.DB.prepare(
        'CREATE INDEX IF NOT EXISTS idx_debug_flow_time ON debug_output(flow_id, timestamp DESC)'
      ).run();
      
      results.push({ statement: 'debug_output table', success: true });
    } catch (err: any) {
      console.error('Debug table error:', err);
      results.push({ statement: 'debug_output table', success: false, error: err.message });
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
// FLOW CRUD OPERATIONS
// ===================================================================

async function listFlows(env: Env): Promise<Response> {
  try {
    const flows = await env.DB.prepare(
      'SELECT id, name, description, enabled, created_at, updated_at FROM flows ORDER BY updated_at DESC, created_at DESC'
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
    
    const flowConfig: FlowConfig = {
      id: requestData.id || crypto.randomUUID(),
      name: requestData.name || 'Unnamed Flow',
      description: requestData.description,
      version: requestData.version || '1.0.0',
      nodes: requestData.nodes || []
    };
    
    const validation = validateFlow(flowConfig);
    if (!validation.valid) {
      return jsonResponse({
        error: 'Flow validation failed',
        errors: validation.errors,
        warnings: validation.warnings
      }, corsHeaders, 400);
    }
    
    const httpTriggers = extractHttpTriggers(flowConfig, flowConfig.id);
    
    const statements = [
      env.DB.prepare(`
        INSERT INTO flows (id, name, description, config, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
      `).bind(
        flowConfig.id,
        flowConfig.name,
        flowConfig.description || '',
        JSON.stringify(flowConfig)
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
    
    const flowConfig: FlowConfig = {
      id: flowId,
      name: requestData.name || 'Unnamed Flow',
      description: requestData.description,
      version: requestData.version || '1.0.0',
      nodes: requestData.nodes || []
    };
    
    const validation = validateFlow(flowConfig);
    if (!validation.valid) {
      return jsonResponse({
        error: 'Flow validation failed',
        errors: validation.errors,
        warnings: validation.warnings
      }, corsHeaders, 400);
    }
    
    const httpTriggers = extractHttpTriggers(flowConfig, flowId);
    
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

// Continue to part 2...
// ===================================================================
// IMPORT/EXPORT OPERATIONS
// ===================================================================

async function exportFlow(env: Env, flowId: string): Promise<Response> {
  try {
    const flow = await env.DB.prepare('SELECT * FROM flows WHERE id = ?').bind(flowId).first();
    
    if (!flow) {
      return jsonResponse({ error: 'Flow not found' }, corsHeaders, 404);
    }
    
    const config = JSON.parse(flow.config as string);
    
    const exportData = {
      id: flow.id,
      name: flow.name,
      description: flow.description,
      version: config.version || '1.0.0',
      nodes: config.nodes,
      connections: config.connections,
      exported_at: new Date().toISOString(),
      exported_from: 'RedNox v2.0'
    };
    
    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${flow.name}.json"`,
        ...corsHeaders
      }
    });
  } catch (err: any) {
    console.error('Error exporting flow:', err);
    return jsonResponse({ 
      error: 'Failed to export flow',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function importFlow(env: Env, request: Request, origin: string): Promise<Response> {
  try {
    const importData = await request.json();
    
    // Validate import data
    if (!importData.name || !importData.nodes) {
      return jsonResponse({
        error: 'Invalid import data',
        hint: 'Flow must have a name and nodes array'
      }, corsHeaders, 400);
    }
    
    // Generate new ID for imported flow
    const newFlowId = crypto.randomUUID();
    
    const flowConfig: FlowConfig = {
      id: newFlowId,
      name: `${importData.name} (Imported)`,
      description: importData.description || '',
      version: importData.version || '1.0.0',
      nodes: importData.nodes || []
    };
    
    // Use the create flow function
    const createRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(flowConfig)
    });
    
    return await createFlow(env, createRequest, origin);
  } catch (err: any) {
    console.error('Error importing flow:', err);
    return jsonResponse({ 
      error: 'Failed to import flow',
      details: err.message
    }, corsHeaders, 500);
  }
}

// ===================================================================
// FLOW EXECUTION
// ===================================================================

async function executeFlowManually(env: Env, flowId: string, request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const nodeId = body.nodeId;
    
    if (!nodeId) {
      return jsonResponse({ 
        error: 'nodeId is required for manual execution'
      }, corsHeaders, 400);
    }
    
    // Log execution attempt
    await env.DB.prepare(`
      INSERT INTO debug_output (flow_id, node_id, message, type, timestamp)
      VALUES (?, ?, ?, 'info', datetime('now'))
    `).bind(flowId, nodeId, 'Manual execution triggered').run();
    
    // Get DO instance
    if (!env.FLOW_EXECUTOR) {
      return jsonResponse({ 
        error: 'Flow executor not configured'
      }, corsHeaders, 500);
    }
    
    const doId = env.FLOW_EXECUTOR.idFromName(`flow:${flowId}`);
    const doStub = env.FLOW_EXECUTOR.get(doId);
    
    // Execute the flow
    const execRequest = new Request(`https://internal/internal/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        payload: body.payload || {}
      })
    });
    
    const response = await doStub.fetch(execRequest);
    const result = await response.json();
    
    // Log execution result
    const logType = response.ok ? 'success' : 'error';
    const logMessage = response.ok ? 'Execution completed' : `Execution failed: ${result.error || 'Unknown error'}`;
    
    await env.DB.prepare(`
      INSERT INTO debug_output (flow_id, node_id, message, type, timestamp)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).bind(flowId, nodeId, logMessage, logType).run();
    
    return jsonResponse({
      success: response.ok,
      output: result,
      executionTime: new Date().toISOString()
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error executing flow:', err);
    
    // Log error
    try {
      await env.DB.prepare(`
        INSERT INTO debug_output (flow_id, node_id, message, type, timestamp)
        VALUES (?, ?, ?, 'error', datetime('now'))
      `).bind(flowId, 'system', `Execution error: ${err.message}`).run();
    } catch (logErr) {
      console.error('Failed to log error:', logErr);
    }
    
    return jsonResponse({ 
      error: 'Failed to execute flow',
      details: err.message
    }, corsHeaders, 500);
  }
}

// ===================================================================
// DEBUG & MONITORING
// ===================================================================

async function getDebugOutput(env: Env, flowId: string, limit: number): Promise<Response> {
  try {
    const output = await env.DB.prepare(
      'SELECT * FROM debug_output WHERE flow_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).bind(flowId, limit).all();
    
    return jsonResponse({ 
      output: output.results || [],
      count: output.results?.length || 0
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error fetching debug output:', err);
    return jsonResponse({ 
      error: 'Failed to fetch debug output',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function getFlowLogs(env: Env, flowId: string, limit: number): Promise<Response> {
  try {
    const logs = await env.DB.prepare(
      'SELECT * FROM flow_logs WHERE flow_id = ? ORDER BY executed_at DESC LIMIT ?'
    ).bind(flowId, limit).all();
    
    return jsonResponse({ 
      logs: logs.results || [],
      count: logs.results?.length || 0
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error fetching logs:', err);
    return jsonResponse({ 
      error: 'Failed to fetch logs',
      details: err.message
    }, corsHeaders, 500);
  }
}

// ===================================================================
// ROUTES & STATISTICS
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

async function getStats(env: Env): Promise<Response> {
  try {
    const [flowCount, enabledFlowCount, routeCount, logCount, nodeCount] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as count FROM flows').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM flows WHERE enabled = 1').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM http_routes WHERE enabled = 1').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM flow_logs').first(),
      Promise.resolve({ count: registry.list().length })
    ]);
    
    return jsonResponse({
      flows: {
        total: flowCount?.count || 0,
        enabled: enabledFlowCount?.count || 0,
        disabled: (flowCount?.count || 0) - (enabledFlowCount?.count || 0)
      },
      routes: routeCount?.count || 0,
      logs: logCount?.count || 0,
      nodes: nodeCount.count
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error fetching stats:', err);
    return jsonResponse({
      error: 'Failed to fetch stats',
      details: err.message
    }, corsHeaders, 500);
  }
}

// ===================================================================
// HELPER FUNCTIONS
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
      
      // Create flow-specific path
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
