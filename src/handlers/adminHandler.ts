// ===================================================================
// adminHandler.ts - Complete Admin API with Context Management
// ===================================================================

import { Env, FlowConfig } from '../types/core';
import { jsonResponse, validateFlow } from '../utils';
import { registry } from '../core/NodeRegistry';
import { ExecutionContextManager } from '../core/PersistentContext';
import { D1_SCHEMA_STATEMENTS } from '../db/schema';

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
    // CONFIG NODE MANAGEMENT (NEW)
    // ===================================================================

    if (path === '/admin/config-nodes' && request.method === 'GET') {
      return await listConfigNodes(env, url.searchParams.get('type') || undefined);
    }

    if (path.match(/^\/admin\/config-nodes\/[^/]+$/) && request.method === 'GET') {
      const configId = path.split('/').pop()!;
      return await getConfigNode(env, configId);
    }

    // ===================================================================
// TOOL MANAGEMENT (NEW)
// ===================================================================

if (path === '/admin/tools' && request.method === 'GET') {
  return await listTools(env, url.searchParams.get('type') || undefined);
}

if (path.match(/^\/admin\/tools\/[^/]+$/) && request.method === 'GET') {
  const toolId = path.split('/').pop()!;
  return await getTool(env, toolId);
}

if (path === '/admin/tool-types' && request.method === 'GET') {
  return listToolTypes();
}

// Add these functions at the end of the file:

/**
 * List all tool configurations
 */
async function listTools(env: Env, type?: string): Promise<Response> {
  try {
    const flows = await env.DB.prepare('SELECT config FROM flows').all();
    
    const tools: any[] = [];
    
    for (const flow of flows.results || []) {
      const flowConfig: FlowConfig = JSON.parse(flow.config as string);
      
      const toolNodes = flowConfig.nodes.filter(n => 
        n.isConfigNode === true && 
        ToolRegistry.has(n.type) &&
        (!type || n.type === type)
      );
      
      tools.push(...toolNodes);
    }
    
    // Remove duplicates by ID
    const unique = Array.from(
      new Map(tools.map(t => [t.id, t])).values()
    );
    
    return jsonResponse({
      tools: unique,
      count: unique.length,
      type: type || 'all'
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error listing tools:', err);
    return jsonResponse({ 
      error: 'Failed to list tools',
      details: err.message
    }, corsHeaders, 500);
  }
}

/**
 * Get specific tool configuration
 */
async function getTool(env: Env, toolId: string): Promise<Response> {
  try {
    const flows = await env.DB.prepare('SELECT config FROM flows').all();
    
    for (const flow of flows.results || []) {
      const flowConfig: FlowConfig = JSON.parse(flow.config as string);
      const tool = flowConfig.nodes.find(n => 
        n.id === toolId && n.isConfigNode === true && ToolRegistry.has(n.type)
      );
      
      if (tool) {
        return jsonResponse(tool, corsHeaders);
      }
    }
    
    return jsonResponse({ 
      error: 'Tool not found',
      toolId 
    }, corsHeaders, 404);
  } catch (err: any) {
    console.error('Error getting tool:', err);
    return jsonResponse({ 
      error: 'Failed to get tool',
      details: err.message
    }, corsHeaders, 500);
  }
}

/**
 * List available tool types
 */
function listToolTypes(): Response {
  const toolTypes = ToolRegistry.list().map(type => {
    const definition = ToolRegistry.get(type);
    return {
      type,
      name: definition?.ui?.paletteLabel || type,
      description: definition?.ui?.info || '',
      icon: definition?.ui?.icon || '🔧',
      color: definition?.ui?.color || '#666666',
    };
  });
  
  return jsonResponse({
    toolTypes,
    count: toolTypes.length
  }, corsHeaders);
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
    // DEBUG EXECUTION
    // ===================================================================
    
    if (path.match(/^\/admin\/flows\/[^/]+\/debug-execute$/) && request.method === 'POST') {
      const flowId = path.split('/')[3];
      return await debugExecuteFlow(env, flowId, request);
    }
    
    // ===================================================================
    // CONTEXT MANAGEMENT (NEW)
    // ===================================================================
    
    // Get execution history for a conversation
    if (path.match(/^\/admin\/flows\/[^/]+\/contexts\/[^/]+$/) && request.method === 'GET') {
      return await getConversationContexts(env, path, url);
    }
    
    // Get all conversations for a flow
    if (path.match(/^\/admin\/flows\/[^/]+\/conversations$/) && request.method === 'GET') {
      return await getFlowConversations(env, path);
    }
    
    // Delete a conversation
    if (path.match(/^\/admin\/flows\/[^/]+\/contexts\/[^/]+$/) && request.method === 'DELETE') {
      return await deleteConversation(env, path);
    }
    
    // Get flow context (persistent key-value)
    if (path.match(/^\/admin\/flows\/[^/]+\/context$/) && request.method === 'GET') {
      return await getFlowContext(env, path);
    }
    
    // Set flow context value
    if (path.match(/^\/admin\/flows\/[^/]+\/context$/) && request.method === 'POST') {
      return await setFlowContext(env, path, request);
    }
    
    // Delete flow context key
    if (path.match(/^\/admin\/flows\/[^/]+\/context\/[^/]+$/) && request.method === 'DELETE') {
      return await deleteFlowContextKey(env, path);
    }
    
    // Get context statistics
    if (path.match(/^\/admin\/flows\/[^/]+\/context-stats$/) && request.method === 'GET') {
      return await getContextStats(env, path);
    }
    
    // Manual cleanup trigger
    if (path === '/admin/contexts/cleanup' && request.method === 'POST') {
      return await cleanupAllContexts(env, request);
    }
    
    // Global context management
    if (path === '/admin/global-context' && request.method === 'GET') {
      return await getGlobalContext(env);
    }
    
    if (path === '/admin/global-context' && request.method === 'POST') {
      return await setGlobalContext(env, request);
    }
    
    if (path.match(/^\/admin\/global-context\/[^/]+$/) && request.method === 'DELETE') {
      return await deleteGlobalContextKey(env, path);
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
      statements: results.length,
      tables: ['flows', 'http_routes', 'execution_contexts', 'flow_context_store'],
      features: [
        'Flow definitions storage',
        'HTTP route mapping',
        'Persistent execution contexts',
        'Flow & global context store',
        'Auto-cleanup enabled'
      ]
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
      fullUrl: `\( {origin}/api \){route.path}`
    }));
    
    // Get context stats
    const contextManager = new ExecutionContextManager(env.DB);
    const contextStats = await contextManager.getFlowStats(flowId);
    
    return jsonResponse({
      ...flow,
      config: JSON.parse(flow.config as string),
      routes: routesWithUrls,
      contextStats
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
        url: `\( {origin}/api \){t.path}`,
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
        url: `\( {origin}/api \){t.path}`,
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
      message: 'Flow deleted successfully (cascading delete will remove routes and contexts)' 
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

async function listConfigNodes(env: Env, type?: string): Promise<Response> {
  try {
    const flows = await env.DB.prepare('SELECT config FROM flows').all();
    
    const configNodes: any[] = [];
    
    for (const flow of flows.results || []) {
      const flowConfig: FlowConfig = JSON.parse(flow.config as string);
      
      const configs = flowConfig.nodes.filter(n => 
        n.isConfigNode === true && (!type || n.type === type)
      );
      
      configNodes.push(...configs);
    }
    
    // Remove duplicates by ID
    const unique = Array.from(
      new Map(configNodes.map(c => [c.id, c])).values()
    );
    
    return jsonResponse({
      configNodes: unique,
      count: unique.length,
      type: type || 'all'
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error listing config nodes:', err);
    return jsonResponse({ 
      error: 'Failed to list config nodes',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function getConfigNode(env: Env, configId: string): Promise<Response> {
  try {
    const flows = await env.DB.prepare('SELECT config FROM flows').all();
    
    for (const flow of flows.results || []) {
      const flowConfig: FlowConfig = JSON.parse(flow.config as string);
      const config = flowConfig.nodes.find(n => 
        n.id === configId && n.isConfigNode === true
      );
      
      if (config) {
        return jsonResponse(config, corsHeaders);
      }
    }
    
    return jsonResponse({ 
      error: 'Config node not found',
      configId 
    }, corsHeaders, 404);
  } catch (err: any) {
    console.error('Error getting config node:', err);
    return jsonResponse({ 
      error: 'Failed to get config node',
      details: err.message
    }, corsHeaders, 500);
  }
}

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
      exported_at: new Date().toISOString(),
      exported_from: 'RedNox v3.0'
    };
    
    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${flow.id}.json"`,
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
    
    if (!importData.name || !importData.nodes) {
      return jsonResponse({
        error: 'Invalid import data',
        hint: 'Flow must have a name and nodes array'
      }, corsHeaders, 400);
    }
    
    const newFlowId = crypto.randomUUID();
    
    const flowConfig: FlowConfig = {
      id: newFlowId,
      name: `${importData.name} (Imported)`,
      description: importData.description || '',
      version: importData.version || '1.0.0',
      nodes: importData.nodes || []
    };
    
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
// DEBUG EXECUTION
// ===================================================================

async function debugExecuteFlow(env: Env, flowId: string, request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const nodeId = body.nodeId;
    const payload = body.payload;
    const conversationId = body.conversationId;
    
    if (!nodeId) {
      return jsonResponse({ 
        error: 'nodeId is required for debug execution'
      }, corsHeaders, 400);
    }
    
    if (!env.FLOW_EXECUTOR) {
      return jsonResponse({ 
        error: 'Flow executor not configured'
      }, corsHeaders, 500);
    }
    
    const doId = env.FLOW_EXECUTOR.idFromName(`flow:${flowId}`);
    const doStub = env.FLOW_EXECUTOR.get(doId);
    
    // Call the DO's internal debug endpoint
    const execRequest = new Request(`https://internal/internal/debug-execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flowId,
        nodeId,
        payload: payload || {},
        conversationId: conversationId || 'debug'
      })
    });
    
    const response = await doStub.fetch(execRequest);
    const result = await response.json();
    
    // Return the complete debug trace to frontend
    return jsonResponse(result, corsHeaders);
    
  } catch (err: any) {
    console.error('Error executing debug flow:', err);
    return jsonResponse({ 
      error: 'Failed to execute debug flow',
      details: err.message
    }, corsHeaders, 500);
  }
}

// ===================================================================
// CONTEXT MANAGEMENT
// ===================================================================

async function getConversationContexts(env: Env, path: string, url: URL): Promise<Response> {
  try {
    const pathParts = path.split('/');
    const flowId = pathParts[3];
    const conversationId = pathParts[5];
    
    const limit = parseInt(url.searchParams.get('limit') || '50');
    
    const contextManager = new ExecutionContextManager(env.DB);
    const contexts = await contextManager.getContext(flowId, conversationId, limit);
    
    return jsonResponse({
      flowId,
      conversationId,
      contexts,
      count: contexts.length
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error getting conversation contexts:', err);
    return jsonResponse({
      error: 'Failed to get conversation contexts',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function getFlowConversations(env: Env, path: string): Promise<Response> {
  try {
    const flowId = path.split('/')[3];
    
    const results = await env.DB.prepare(`
      SELECT 
        conversation_id,
        COUNT(*) as execution_count,
        MAX(executed_at) as last_execution,
        MIN(executed_at) as first_execution
      FROM execution_contexts
      WHERE flow_id = ?
      GROUP BY conversation_id
      ORDER BY last_execution DESC
    `).bind(flowId).all();
    
    return jsonResponse({
      flowId,
      conversations: results.results || [],
      count: results.results?.length || 0
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error getting flow conversations:', err);
    return jsonResponse({
      error: 'Failed to get conversations',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function deleteConversation(env: Env, path: string): Promise<Response> {
  try {
    const pathParts = path.split('/');
    const flowId = pathParts[3];
    const conversationId = pathParts[5];
    
    const contextManager = new ExecutionContextManager(env.DB);
    const deleted = await contextManager.deleteConversation(flowId, conversationId);
    
    return jsonResponse({
      success: true,
      deleted,
      flowId,
      conversationId,
      message: `Deleted ${deleted} execution contexts`
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error deleting conversation:', err);
    return jsonResponse({
      error: 'Failed to delete conversation',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function getFlowContext(env: Env, path: string): Promise<Response> {
  try {
    const flowId = path.split('/')[3];
    
    const results = await env.DB.prepare(
      'SELECT key, value, updated_at FROM flow_context_store WHERE flow_id = ? ORDER BY key'
    ).bind(flowId).all();
    
    const context: Record<string, any> = {};
    results.results?.forEach(r => {
      context[r.key as string] = {
        value: JSON.parse(r.value as string),
        updated_at: r.updated_at
      };
    });
    
    return jsonResponse({
      flowId,
      context,
      count: Object.keys(context).length
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error getting flow context:', err);
    return jsonResponse({
      error: 'Failed to get flow context',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function setFlowContext(env: Env, path: string, request: Request): Promise<Response> {
  try {
    const flowId = path.split('/')[3];
    const { key, value } = await request.json();
    
    if (!key) {
      return jsonResponse({
        error: 'Key is required'
      }, corsHeaders, 400);
    }
    
    await env.DB.prepare(`
      INSERT INTO flow_context_store (flow_id, key, value, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT (flow_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).bind(flowId, key, JSON.stringify(value)).run();
    
    return jsonResponse({
      success: true,
      flowId,
      key,
      value,
      message: 'Context value set successfully'
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error setting flow context:', err);
    return jsonResponse({
      error: 'Failed to set flow context',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function deleteFlowContextKey(env: Env, path: string): Promise<Response> {
  try {
    const pathParts = path.split('/');
    const flowId = pathParts[3];
    const key = pathParts[5];
    
    const result = await env.DB.prepare(
      'DELETE FROM flow_context_store WHERE flow_id = ? AND key = ?'
    ).bind(flowId, key).run();
    
    return jsonResponse({
      success: true,
      deleted: result.meta.changes || 0,
      flowId,
      key,
      message: result.meta.changes ? 'Context key deleted' : 'Key not found'
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error deleting flow context key:', err);
    return jsonResponse({
      error: 'Failed to delete flow context key',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function getContextStats(env: Env, path: string): Promise<Response> {
  try {
    const flowId = path.split('/')[3];
    
    const contextManager = new ExecutionContextManager(env.DB);
    const stats = await contextManager.getFlowStats(flowId);
    
    // Get context store stats
    const contextStoreCount = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM flow_context_store WHERE flow_id = ?'
    ).bind(flowId).first();
    
    return jsonResponse({
      flowId,
      executionContexts: stats,
      contextStore: {
        keys: contextStoreCount?.count || 0
      }
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error getting context stats:', err);
    return jsonResponse({
      error: 'Failed to get context stats',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function cleanupAllContexts(env: Env, request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const maxExecutionsPerFlow = body.maxExecutionsPerFlow || 100;
    const maxContextsPerConversation = body.maxContextsPerConversation || 20;
    
    const contextManager = new ExecutionContextManager(env.DB, {
      maxExecutionsPerFlow,
      maxContextsPerConversation,
      cleanupOnWrite: true
    });
    
    const result = await contextManager.cleanupAllFlows();
    
    return jsonResponse({
      success: true,
      ...result,
      config: {
        maxExecutionsPerFlow,
        maxContextsPerConversation
      },
      message: 'Cleanup completed successfully'
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error cleaning up contexts:', err);
    return jsonResponse({
      error: 'Failed to cleanup contexts',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function getGlobalContext(env: Env): Promise<Response> {
  try {
    const results = await env.DB.prepare(
      'SELECT key, value, updated_at FROM flow_context_store WHERE flow_id = ? ORDER BY key'
    ).bind('__global__').all();
    
    const context: Record<string, any> = {};
    results.results?.forEach(r => {
      context[r.key as string] = {
        value: JSON.parse(r.value as string),
        updated_at: r.updated_at
      };
    });
    
    return jsonResponse({
      context,
      count: Object.keys(context).length
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error getting global context:', err);
    return jsonResponse({
      error: 'Failed to get global context',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function setGlobalContext(env: Env, request: Request): Promise<Response> {
  try {
    const { key, value } = await request.json();
    
    if (!key) {
      return jsonResponse({
        error: 'Key is required'
      }, corsHeaders, 400);
    }
    
    await env.DB.prepare(`
      INSERT INTO flow_context_store (flow_id, key, value, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT (flow_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).bind('__global__', key, JSON.stringify(value)).run();
    
    return jsonResponse({
      success: true,
      key,
      value,
      message: 'Global context value set successfully'
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error setting global context:', err);
    return jsonResponse({
      error: 'Failed to set global context',
      details: err.message
    }, corsHeaders, 500);
  }
}

async function deleteGlobalContextKey(env: Env, path: string): Promise<Response> {
  try {
    const key = path.split('/')[3];
    
    const result = await env.DB.prepare(
      'DELETE FROM flow_context_store WHERE flow_id = ? AND key = ?'
    ).bind('__global__', key).run();
    
    return jsonResponse({
      success: true,
      deleted: result.meta.changes || 0,
      key,
      message: result.meta.changes ? 'Global context key deleted' : 'Key not found'
    }, corsHeaders);
  } catch (err: any) {
    console.error('Error deleting global context key:', err);
    return jsonResponse({
      error: 'Failed to delete global context key',
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
      fullUrl: `\( {origin}/api \){route.path}`
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
    const [
      flowCount, 
      enabledFlowCount, 
      routeCount, 
      nodeCount, 
      contextStats, 
      executionStats
    ] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as count FROM flows').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM flows WHERE enabled = 1').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM http_routes WHERE enabled = 1').first(),
      Promise.resolve({ count: registry.list().length }),
      env.DB.prepare('SELECT COUNT(*) as count FROM flow_context_store').first(),
      env.DB.prepare(`
        SELECT 
          COUNT(*) as total_executions,
          COUNT(DISTINCT flow_id) as flows_with_executions,
          COUNT(DISTINCT conversation_id) as total_conversations
        FROM execution_contexts
      `).first()
    ]);
    
    return jsonResponse({
      flows: {
        total: flowCount?.count || 0,
        enabled: enabledFlowCount?.count || 0,
        disabled: (flowCount?.count || 0) - (enabledFlowCount?.count || 0)
      },
      routes: routeCount?.count || 0,
      nodes: {
        registered: nodeCount.count,
        categories: registry.getByCategory().size
      },
      context: {
        persistentKeys: contextStats?.count || 0,
        totalExecutions: executionStats?.total_executions || 0,
        flowsWithExecutions: executionStats?.flows_with_executions || 0,
        totalConversations: executionStats?.total_conversations || 0
      },
      runtime: 'ephemeral with persistent context',
      storage: 'D1 Database (Free Tier)',
      features: [
        'Auto-cleanup enabled',
        'Conversation history',
        'Flow & global context',
        'Debug execution with trace'
      ]
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
      
      const fullPath = `/\( {flowId} \){nodePath}`;
      
      triggers.push({
        nodeId: node.id,
        path: fullPath,
        method: (node.method || 'post').toUpperCase()
      });
    }
  }
  
  return triggers;
}
