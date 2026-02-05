// ===================================================================
// MemoryManager - Unified Memory Management
// ===================================================================

import { ExecutionContext, MemoryConfig } from '../types/core';
import { LLMMessage } from '../providers/base';
import { ProviderFactory } from '../providers/factory';
import { createConfigRegistry } from './ConfigNodeRegistry';

export class MemoryManager {
  /**
   * Load conversation history from memory
   */
  static async load(
    memoryConfig: MemoryConfig,
    conversationId: string,
    context: ExecutionContext
  ): Promise<LLMMessage[]> {
    const key = this.getStorageKey(memoryConfig, conversationId);
    
    switch (memoryConfig.memoryType) {
      case 'conversation-buffer':
        return await this.loadConversationBuffer(key, memoryConfig, context);
      
      case 'window-buffer':
        return await this.loadWindowBuffer(key, memoryConfig, context);
      
      case 'summary-buffer':
        return await this.loadSummaryBuffer(key, memoryConfig, context);
      
      default:
        return [];
    }
  }
  
  /**
   * Save messages to memory
   */
  static async save(
    memoryConfig: MemoryConfig,
    conversationId: string,
    messages: LLMMessage[],
    context: ExecutionContext
  ): Promise<void> {
    const key = this.getStorageKey(memoryConfig, conversationId);
    
    // Apply max messages limit
    const maxMessages = memoryConfig.maxMessages || 50;
    const trimmed = messages.slice(-maxMessages);
    
    // Store based on scope
    const storage = memoryConfig.storageScope === 'global'
      ? context.global
      : context.flow;
    
    await storage.set(key, trimmed);
  }
  
  /**
   * Append new messages to existing memory
   */
  static async append(
    memoryConfig: MemoryConfig,
    conversationId: string,
    newMessages: LLMMessage[],
    context: ExecutionContext
  ): Promise<void> {
    const existing = await this.load(memoryConfig, conversationId, context);
    const combined = [...existing, ...newMessages];
    await this.save(memoryConfig, conversationId, combined, context);
  }
  
  /**
   * Clear memory for a conversation
   */
  static async clear(
    memoryConfig: MemoryConfig,
    conversationId: string,
    context: ExecutionContext
  ): Promise<void> {
    const key = this.getStorageKey(memoryConfig, conversationId);
    const storage = memoryConfig.storageScope === 'global'
      ? context.global
      : context.flow;
    
    await storage.set(key, []);
  }
  
  /**
   * Get storage key for memory
   */
  private static getStorageKey(
    memoryConfig: MemoryConfig,
    conversationId: string
  ): string {
    return `memory:${memoryConfig.id}:${conversationId}`;
  }
  
  /**
   * Load conversation buffer (all messages)
   */
  private static async loadConversationBuffer(
    key: string,
    config: MemoryConfig,
    context: ExecutionContext
  ): Promise<LLMMessage[]> {
    const storage = config.storageScope === 'global'
      ? context.global
      : context.flow;
    
    return await storage.get(key) || [];
  }
  
  /**
   * Load window buffer (last N messages)
   */
  private static async loadWindowBuffer(
    key: string,
    config: MemoryConfig,
    context: ExecutionContext
  ): Promise<LLMMessage[]> {
    const all = await this.loadConversationBuffer(key, config, context);
    const windowSize = config.windowSize || 10;
    return all.slice(-windowSize);
  }
  
  /**
   * Load summary buffer (summarize if too long)
   */
  private static async loadSummaryBuffer(
    key: string,
    config: MemoryConfig,
    context: ExecutionContext
  ): Promise<LLMMessage[]> {
    // Load all messages
    const messages = await this.loadConversationBuffer(key, config, context);
    
    if (messages.length === 0) {
      return [];
    }
    
    // Calculate approximate token count (rough estimate: 1 token ≈ 4 chars)
    const totalTokens = messages.reduce((sum, m) => 
      sum + (m.content?.length || 0) / 4, 0
    );
    
    const maxTokenLimit = config.maxTokenLimit || 2000;
    
    // If under limit, return as-is
    if (totalTokens < maxTokenLimit) {
      return messages;
    }
    
    // Otherwise, summarize old messages
    try {
      const configRegistry = createConfigRegistry(context);
      
      if (!config.summaryModel) {
        console.warn('[MemoryManager] Summary model not configured, returning window');
        return messages.slice(-10);
      }
      
      const summaryModelConfig = await configRegistry.load(config.summaryModel);
      const provider = ProviderFactory.create(summaryModelConfig);
      
      // Keep last 10 messages, summarize the rest
      const toKeep = 10;
      const toSummarize = messages.slice(0, -toKeep);
      const toKeepMessages = messages.slice(-toKeep);
      
      // Create summary
      const conversationText = toSummarize
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');
      
      const summary = await provider.chat({
        model: summaryModelConfig.model,
        messages: [
          {
            role: 'user',
            content: `Summarize this conversation concisely:\n\n${conversationText}`
          }
        ],
        temperature: 0.3,
        maxTokens: 500
      });
      
      // Return summary + recent messages
      return [
        {
          role: 'system',
          content: `Previous conversation summary: ${summary.content}`
        },
        ...toKeepMessages
      ];
      
    } catch (error) {
      console.error('[MemoryManager] Error creating summary:', error);
      // Fallback to window buffer
      return messages.slice(-10);
    }
  }
}
