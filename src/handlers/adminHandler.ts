// ===================================================================
// RedNox - Admin API Handler
// ===================================================================

import { Env, FlowConfig } from '../types/core';
import { D1_SCHEMA } from '../db/schema';
import { jsonResponse } from '../utils';

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    // Initialize database
    if (path === '/admin/init' && request.method === 'POST') {
      await env.DB.exec(D1_SCHEMA);
      return jsonResponse({ success: true, message: 'Database initialized' }, corsHeaders);
    }
    
    // List all flows
    if (path === '/admin/flows' && request.method === 'GET') {
      const flows = await env.DB.prepare(
        'SELECT id, name, description, enabled, created_at, updated_at FROM flows ORDER BY created_at DESC'
      ).all();
      
      return jsonResponse({ flows: flows.results, count: flows.results.length }, corsHeaders);
    }
    
    // Get specific flow
    if (path.match(/^\/admin\/flows\/[^/]+$/) && request.method === 'GET') {
      const flowId = path.split('/').pop();
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
        routes: routes.results
      }, corsHeaders);
    }
    
    // Create new flow
    if (path === '/admin/flows' && request.method === 'POST') {
      const flowData = await request.json() as FlowConfig;
      const flowId = flowData.id || crypto.randomUUID();
      
      if (!flowData.name || !flowData.nodes || flowData.nodes.length === 0) {
        return jsonResponse({ error: 'Invalid flow: name and nodes required' }, corsHeaders, 400);
      }
      
      // Extract HTTP triggers
      const httpTriggers: Array<{ nodeId: string; path: string; method: string }> = [];
      for (const node of flowData.nodes) {
        if (node.type === 'http-in' && node.url) {
          httpTriggers.push({
            nodeId: node.id,
            path: node.url,
            method: (node.method || 'get').toUpperCase()
          });
        }
      }
      
      flowData.httpTriggers = httpTriggers;
      
      // Insert flow
      await env.DB.prepare(`
        INSERT INTO flows (id, name, description, config, enabled)
        VALUES (?, ?, ?, ?, 1)
      `).bind(
        flowId,
        flowData.name,
        flowData.description || '',
        JSON.stringify({ ...flowData, id: flowId })
      ).run();
      
      // Insert HTTP routes
      for (const trigger of httpTriggers) {
        await env.DB.prepare(`
          INSERT INTO http_routes (id, flow_id, node_id, path, method, enabled)
          VALUES (?, ?, ?, ?, ?, 1)
        `).bind(
          crypto.randomUUID(),
          flowId,
          trigger.nodeId,
          trigger.path,
          trigger.method
        ).run();
      }
      
      return jsonResponse({ 
        success: true, 
        flowId,
        httpTriggers: httpTriggers.length,
        message: 'Flow created successfully'
      }, corsHeaders, 201);
    }
    
    // Update flow
    if (path.match(/^\/admin\/flows\/[^/]+$/) && request.method === 'PUT') {
      const flowId = path.split('/').pop();
      const flowData = await request.json() as FlowConfig;
      
      // Extract HTTP triggers
      const httpTriggers: Array<{ nodeId: string; path: string; method: string }> = [];
      for (const node of flowData.nodes) {
        if (node.type === 'http-in' && node.url) {
          httpTriggers.push({
            nodeId: node.id,
            path: node.url,
            method: (node.method || 'get').toUpperCase()
          });
        }
      }
      
      flowData.httpTriggers = httpTriggers;
      
      // Update flow
      const result = await env.DB.prepare(`
        UPDATE flows 
        SET name = ?, description = ?, config = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(
        flowData.name,
        flowData.description || '',
        JSON.stringify({ ...flowData, id: flowId }),
        flowId
      ).run();
      
      if (result.meta.changes === 0) {
        return jsonResponse({ error: 'Flow not found' }, corsHeaders, 404);
      }
      
      // Delete old routes and insert new ones
      await env.DB.prepare('DELETE FROM http_routes WHERE flow_id = ?').bind(flowId).run();
      
      for (const trigger of httpTriggers) {
        await env.DB.prepare(`
          INSERT INTO http_routes (id, flow_id, node_id, path, method, enabled)
          VALUES (?, ?, ?, ?, ?, 1)
        `).bind(
          crypto.randomUUID(),
          flowId,
          trigger.nodeId,
          trigger.path,
          trigger.method
        ).run();
      }
      
      return jsonResponse({ 
        success: true, 
        message: 'Flow updated successfully' 
      }, corsHeaders);
    }
    
    // Delete flow
    if (path.match(/^\/admin\/flows\/[^/]+$/) && request.method === 'DELETE') {
      const flowId = path.split('/').pop();
      
      const result = await env.DB.prepare('DELETE FROM flows WHERE id = ?').bind(flowId).run();
      
      if (result.meta.changes === 0) {
        return jsonResponse({ error: 'Flow not found' }, corsHeaders, 404);
      }
      
      return jsonResponse({ success: true, message: 'Flow deleted successfully' }, corsHeaders);
    }
    
    // Enable/disable flow
    if (path.match(/^\/admin\/flows\/[^/]+\/(enable|disable)$/) && request.method === 'POST') {
      const parts = path.split('/');
      const flowId = parts[parts.length - 2];
      const action = parts[parts.length - 1];
      const enabled = action === 'enable' ? 1 : 0;
      
      await env.DB.prepare(
        'UPDATE flows SET enabled = ?, updated_at = datetime(\'now\') WHERE id = ?'
      ).bind(enabled, flowId).run();
      
      await env.DB.prepare(
        'UPDATE http_routes SET enabled = ? WHERE flow_id = ?'
      ).bind(enabled, flowId).run();
      
      return jsonResponse({ 
        success: true, 
        enabled: enabled === 1,
        message: `Flow ${action}d successfully`
      }, corsHeaders);
    }
    
    // Get flow logs
    if (path.match(/^\/admin\/flows\/[^/]+\/logs$/) && request.method === 'GET') {
      const flowId = path.split('/')[3];
      const limit = parseInt(url.searchParams.get('limit') || '50');
      
      const logs = await env.DB.prepare(
        'SELECT * FROM flow_logs WHERE flow_id = ? ORDER BY executed_at DESC LIMIT ?'
      ).bind(flowId, limit).all();
      
      return jsonResponse({ logs: logs.results }, corsHeaders);
    }
    
    // Get debug messages from DO via RPC
    if (path.match(/^\/admin\/flows\/[^/]+\/debug$/) && request.method === 'GET') {
      const flowId = path.split('/')[3];
      
      const doId = env.FLOW_EXECUTOR.idFromName(flowId);
      const doStub = env.FLOW_EXECUTOR.get(doId);
      
      const messages = await doStub.getDebugMessages();
      return jsonResponse({ messages }, corsHeaders);
    }
    
    // Get flow status from DO via RPC
    if (path.match(/^\/admin\/flows\/[^/]+\/status$/) && request.method === 'GET') {
      const flowId = path.split('/')[3];
      
      const doId = env.FLOW_EXECUTOR.idFromName(flowId);
      const doStub = env.FLOW_EXECUTOR.get(doId);
      
      const status = await doStub.getStatus();
      return jsonResponse(status, corsHeaders);
    }
    
    // List all HTTP routes
    if (path === '/admin/routes' && request.method === 'GET') {
      const routes = await env.DB.prepare(`
        SELECT r.*, f.name as flow_name 
        FROM http_routes r
        JOIN flows f ON f.id = r.flow_id
        WHERE r.enabled = 1
        ORDER BY r.path, r.method
      `).all();
      
      return jsonResponse({ routes: routes.results, count: routes.results.length }, corsHeaders);
    }
    
    // Import flows (bulk)
    if (path === '/admin/flows/import' && request.method === 'POST') {
      const { flows } = await request.json() as { flows: FlowConfig[] };
      const results = [];
      
      for (const flowData of flows) {
        try {
          const flowId = flowData.id || crypto.randomUUID();
          
          // Extract HTTP triggers
          const httpTriggers: Array<{ nodeId: string; path: string; method: string }> = [];
          for (const node of flowData.nodes) {
            if (node.type === 'http-in' && node.url) {
              httpTriggers.push({
                nodeId: node.id,
                path: node.url,
                method: (node.method || 'get').toUpperCase()
              });
            }
          }
          
          flowData.httpTriggers = httpTriggers;
          
          await env.DB.prepare(`
            INSERT OR REPLACE INTO flows (id, name, description, config, enabled)
            VALUES (?, ?, ?, ?, 1)
          `).bind(
            flowId,
            flowData.name,
            flowData.description || '',
            JSON.stringify({ ...flowData, id: flowId })
          ).run();
          
          // Delete old routes
          await env.DB.prepare('DELETE FROM http_routes WHERE flow_id = ?').bind(flowId).run();
          
          // Insert new routes
          for (const trigger of httpTriggers) {
            await env.DB.prepare(`
              INSERT INTO http_routes (id, flow_id, node_id, path, method, enabled)
              VALUES (?, ?, ?, ?, ?, 1)
            `).bind(
              crypto.randomUUID(),
              flowId,
              trigger.nodeId,
              trigger.path,
              trigger.method
            ).run();
          }
          
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
    }
    
    // Export flows
    if (path === '/admin/flows/export' && request.method === 'GET') {
      const flows = await env.DB.prepare('SELECT config FROM flows WHERE enabled = 1').all();
      const exportData = flows.results.map(f => JSON.parse(f.config as string));
      
      return new Response(JSON.stringify(exportData, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="flows-export.json"',
          ...corsHeaders
        }
      });
    }
    
    return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
    
  } catch (err: any) {
    console.error('Admin error:', err);
    return jsonResponse({ error: err.message }, corsHeaders, 500);
  }
}
