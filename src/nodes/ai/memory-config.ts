// ===================================================================
// Memory Config Node
// ===================================================================

import { registry } from '../../core/NodeRegistry';
import { NodeMessage } from '../../types/core';

registry.register('memory-config', {
  type: 'memory-config',
  category: 'config',
  defaults: {
    name: { value: '' },
    memoryType: { value: 'conversation-buffer' },
    
    // Conversation buffer
    maxMessages: { value: 50 },
    
    // Window buffer
    windowSize: { value: 10 },
    
    // Summary buffer
    summaryModel: { value: '' },
    maxTokenLimit: { value: 2000 },
    
    // Common
    storageScope: { value: 'conversation' },
    ttl: { value: 0 },
  },
  inputs: 0,
  outputs: 0,
  
  execute: async (msg: NodeMessage) => null,
  
  ui: {
    icon: '🧠',
    color: '#9B59B6',
    colorLight: '#BB8FCE',
    paletteLabel: 'Memory',
    label: (node) => node.name || `Memory (${node.memoryType})`,
    isConfigNode: true,
    
    info: `
      <h3>Memory Configuration</h3>
      <p>Configure conversation memory management for agents.</p>
      
      <h4>Memory Types:</h4>
      <ul>
        <li><strong>Conversation Buffer</strong> - Store all messages up to max limit</li>
        <li><strong>Window Buffer</strong> - Keep only last N messages</li>
        <li><strong>Summary Buffer</strong> - Summarize old messages when limit reached</li>
      </ul>
      
      <h4>Storage Scopes:</h4>
      <ul>
        <li><strong>Conversation</strong> - Per conversation ID (isolated sessions)</li>
        <li><strong>Flow</strong> - Shared within this flow (all conversations)</li>
        <li><strong>Global</strong> - Shared across all flows</li>
      </ul>
    `,
    
    properties: [
      {
        name: 'name',
        label: 'Config Name',
        type: 'text',
        required: true,
        placeholder: 'Conversation Memory',
        description: 'Friendly name for this memory configuration',
      },
      {
        name: 'memoryType',
        label: 'Memory Type',
        type: 'select',
        required: true,
        options: [
          { 
            value: 'conversation-buffer', 
            label: 'Conversation Buffer',
            description: 'Store all messages up to max limit'
          },
          { 
            value: 'window-buffer', 
            label: 'Window Buffer',
            description: 'Keep only last N messages'
          },
          { 
            value: 'summary-buffer', 
            label: 'Summary Buffer',
            description: 'Summarize old messages when limit reached'
          },
        ],
        default: 'conversation-buffer',
      },
      {
        name: 'maxMessages',
        label: 'Max Messages',
        type: 'number',
        default: 50,
        min: 1,
        max: 1000,
        show: { memoryType: 'conversation-buffer' },
        description: 'Maximum messages to store',
      },
      {
        name: 'windowSize',
        label: 'Window Size',
        type: 'number',
        default: 10,
        min: 1,
        max: 100,
        show: { memoryType: 'window-buffer' },
        description: 'Number of recent messages to keep',
      },
      {
        name: 'summaryModel',
        label: 'Summary Model',
        type: 'select',
        loadOptions: 'listLLMProviders',
        show: { memoryType: 'summary-buffer' },
        description: 'LLM provider for summarization',
      },
      {
        name: 'maxTokenLimit',
        label: 'Max Token Limit',
        type: 'number',
        default: 2000,
        min: 100,
        max: 100000,
        show: { memoryType: 'summary-buffer' },
        description: 'Summarize when token count exceeds this',
      },
      {
        name: 'storageScope',
        label: 'Storage Scope',
        type: 'select',
        required: true,
        options: [
          { value: 'conversation', label: 'Conversation (Per Session)' },
          { value: 'flow', label: 'Flow (Shared in Flow)' },
          { value: 'global', label: 'Global (Shared Everywhere)' },
        ],
        default: 'conversation',
        description: 'Where to store memory',
      },
      {
        name: 'ttl',
        label: 'TTL (seconds)',
        type: 'number',
        default: 0,
        min: 0,
        description: 'Time to live (0 = no expiration)',
      },
    ],
  },
});
