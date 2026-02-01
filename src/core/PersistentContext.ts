// ===================================================================
// RedNox - D1-Based Persistent Context Manager
// ===================================================================

import { FlowContext, GlobalContext } from '../types/core';

export interface PersistentContextConfig {
  maxExecutionsPerFlow: number;
  maxContextsPerConversation: number;
  cleanupOnWrite: boolean;
}

// ===================================================================
// Persistent Flow Context (D1-backed key-value store)
// ===================================================================

export class PersistentFlowContext implements FlowContext {
  private flowId: string;
  private db: D1Database;
  private cache = new Map<string, any>();
  
  constructor(flowId: string, db: D1Database) {
    this.flowId = flowId;
    this.db = db;
  }
  
  async get(key: string): Promise<any> {
    // Check cache first
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    
    // Fetch from D1
    try {
      const result = await this.db.prepare(
        'SELECT value FROM flow_context_store WHERE flow_id = ? AND key = ?'
      ).bind(this.flowId, key).first();
      
      if (result) {
        const value = JSON.parse(result.value as string);
        this.cache.set(key, value);
        return value;
      }
    } catch (err) {
      console.error(`[PersistentFlowContext] Error getting ${key}:`, err);
    }
    
    return undefined;
  }
  
  async set(key: string, value: any): Promise<void> {
    this.cache.set(key, value);
    
    try {
      await this.db.prepare(`
        INSERT INTO flow_context_store (flow_id, key, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT (flow_id, key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `).bind(this.flowId, key, JSON.stringify(value)).run();
    } catch (err) {
      console.error(`[PersistentFlowContext] Error setting ${key}:`, err);
      throw err;
    }
  }
  
  async keys(): Promise<string[]> {
    try {
      const results = await this.db.prepare(
        'SELECT key FROM flow_context_store WHERE flow_id = ?'
      ).bind(this.flowId).all();
      
      return results.results?.map(r => r.key as string) || [];
    } catch (err) {
      console.error('[PersistentFlowContext] Error getting keys:', err);
      return [];
    }
  }
  
  clearCache(): void {
    this.cache.clear();
  }
}

// ===================================================================
// Persistent Global Context (D1-backed, shared across all flows)
// ===================================================================

export class PersistentGlobalContext implements GlobalContext {
  private db: D1Database;
  private cache = new Map<string, any>();
  private readonly GLOBAL_FLOW_ID = '__global__';
  
  constructor(db: D1Database) {
    this.db = db;
  }
  
  async get(key: string): Promise<any> {
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    
    try {
      const result = await this.db.prepare(
        'SELECT value FROM flow_context_store WHERE flow_id = ? AND key = ?'
      ).bind(this.GLOBAL_FLOW_ID, key).first();
      
      if (result) {
        const value = JSON.parse(result.value as string);
        this.cache.set(key, value);
        return value;
      }
    } catch (err) {
      console.error(`[PersistentGlobalContext] Error getting ${key}:`, err);
    }
    
    return undefined;
  }
  
  async set(key: string, value: any): Promise<void> {
    this.cache.set(key, value);
    
    try {
      await this.db.prepare(`
        INSERT INTO flow_context_store (flow_id, key, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT (flow_id, key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `).bind(this.GLOBAL_FLOW_ID, key, JSON.stringify(value)).run();
    } catch (err) {
      console.error(`[PersistentGlobalContext] Error setting ${key}:`, err);
      throw err;
    }
  }
  
  async keys(): Promise<string[]> {
    try {
      const results = await this.db.prepare(
        'SELECT key FROM flow_context_store WHERE flow_id = ?'
      ).bind(this.GLOBAL_FLOW_ID).all();
      
      return results.results?.map(r => r.key as string) || [];
    } catch (err) {
      console.error('[PersistentGlobalContext] Error getting keys:', err);
      return [];
    }
  }
  
  clearCache(): void {
    this.cache.clear();
  }
}

// ===================================================================
// Execution Context Manager (for conversation history)
// ===================================================================

export interface ExecutionContextData {
  input: any;
  output: any;
  duration: number;
  timestamp: string;
  [key: string]: any;
}

export class ExecutionContextManager {
  private db: D1Database;
  private config: PersistentContextConfig;
  
  constructor(db: D1Database, config?: Partial<PersistentContextConfig>) {
    this.db = db;
    this.config = {
      maxExecutionsPerFlow: 100,
      maxContextsPerConversation: 20,
      cleanupOnWrite: true,
      ...config
    };
  }
  
  async saveContext(
    flowId: string,
    conversationId: string,
    contextData: ExecutionContextData
  ): Promise<void> {
    const contextId = crypto.randomUUID();
    
    try {
      // Insert new context
      await this.db.prepare(`
        INSERT INTO execution_contexts (id, flow_id, conversation_id, context_data, executed_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).bind(
        contextId,
        flowId,
        conversationId,
        JSON.stringify(contextData)
      ).run();
      
      // Auto-cleanup if enabled
      if (this.config.cleanupOnWrite) {
        await this.cleanupOldContexts(flowId, conversationId);
      }
    } catch (err) {
      console.error('[ExecutionContextManager] Error saving context:', err);
      throw err;
    }
  }
  
  async getContext(
    flowId: string,
    conversationId: string,
    limit: number = 10
  ): Promise<Array<{ data: ExecutionContextData; timestamp: string }>> {
    try {
      const results = await this.db.prepare(`
        SELECT context_data, executed_at
        FROM execution_contexts
        WHERE flow_id = ? AND conversation_id = ?
        ORDER BY executed_at DESC
        LIMIT ?
      `).bind(flowId, conversationId, limit).all();
      
      return results.results?.map(r => ({
        data: JSON.parse(r.context_data as string),
        timestamp: r.executed_at as string
      })) || [];
    } catch (err) {
      console.error('[ExecutionContextManager] Error getting context:', err);
      return [];
    }
  }
  
  async getLatestContext(
    flowId: string,
    conversationId: string
  ): Promise<ExecutionContextData | null> {
    try {
      const result = await this.db.prepare(`
        SELECT context_data
        FROM execution_contexts
        WHERE flow_id = ? AND conversation_id = ?
        ORDER BY executed_at DESC
        LIMIT 1
      `).bind(flowId, conversationId).first();
      
      if (result) {
        return JSON.parse(result.context_data as string);
      }
    } catch (err) {
      console.error('[ExecutionContextManager] Error getting latest context:', err);
    }
    
    return null;
  }
  
  async getConversationCount(flowId: string, conversationId: string): Promise<number> {
    try {
      const result = await this.db.prepare(`
        SELECT COUNT(*) as count
        FROM execution_contexts
        WHERE flow_id = ? AND conversation_id = ?
      `).bind(flowId, conversationId).first();
      
      return (result?.count as number) || 0;
    } catch (err) {
      console.error('[ExecutionContextManager] Error getting count:', err);
      return 0;
    }
  }
  
  private async cleanupOldContexts(
    flowId: string,
    conversationId: string
  ): Promise<void> {
    try {
      // Delete old contexts beyond limit for this conversation
      await this.db.prepare(`
        DELETE FROM execution_contexts
        WHERE id IN (
          SELECT id FROM execution_contexts
          WHERE flow_id = ? AND conversation_id = ?
          ORDER BY executed_at DESC
          LIMIT -1 OFFSET ?
        )
      `).bind(flowId, conversationId, this.config.maxContextsPerConversation).run();
      
      // Also cleanup at flow level (total executions per flow)
      await this.db.prepare(`
        DELETE FROM execution_contexts
        WHERE id IN (
          SELECT id FROM execution_contexts
          WHERE flow_id = ?
          ORDER BY executed_at DESC
          LIMIT -1 OFFSET ?
        )
      `).bind(flowId, this.config.maxExecutionsPerFlow).run();
    } catch (err) {
      console.error('[ExecutionContextManager] Error cleaning up:', err);
    }
  }
  
  async cleanupAllFlows(): Promise<{ deleted: number }> {
    let totalDeleted = 0;
    
    try {
      const flows = await this.db.prepare('SELECT id FROM flows').all();
      
      for (const flow of flows.results || []) {
        const result = await this.db.prepare(`
          DELETE FROM execution_contexts
          WHERE id IN (
            SELECT id FROM execution_contexts
            WHERE flow_id = ?
            ORDER BY executed_at DESC
            LIMIT -1 OFFSET ?
          )
        `).bind(flow.id, this.config.maxExecutionsPerFlow).run();
        
        totalDeleted += result.meta.changes || 0;
      }
    } catch (err) {
      console.error('[ExecutionContextManager] Error cleaning up all flows:', err);
    }
    
    return { deleted: totalDeleted };
  }
  
  async deleteConversation(flowId: string, conversationId: string): Promise<number> {
    try {
      const result = await this.db.prepare(`
        DELETE FROM execution_contexts
        WHERE flow_id = ? AND conversation_id = ?
      `).bind(flowId, conversationId).run();
      
      return result.meta.changes || 0;
    } catch (err) {
      console.error('[ExecutionContextManager] Error deleting conversation:', err);
      return 0;
    }
  }
  
  async getFlowStats(flowId: string): Promise<{
    totalExecutions: number;
    totalConversations: number;
    oldestExecution: string | null;
    newestExecution: string | null;
  }> {
    try {
      const stats = await this.db.prepare(`
        SELECT 
          COUNT(*) as total_executions,
          COUNT(DISTINCT conversation_id) as total_conversations,
          MIN(executed_at) as oldest_execution,
          MAX(executed_at) as newest_execution
        FROM execution_contexts
        WHERE flow_id = ?
      `).bind(flowId).first();
      
      return {
        totalExecutions: (stats?.total_executions as number) || 0,
        totalConversations: (stats?.total_conversations as number) || 0,
        oldestExecution: stats?.oldest_execution as string || null,
        newestExecution: stats?.newest_execution as string || null
      };
    } catch (err) {
      console.error('[ExecutionContextManager] Error getting flow stats:', err);
      return {
        totalExecutions: 0,
        totalConversations: 0,
        oldestExecution: null,
        newestExecution: null
      };
    }
  }
}
