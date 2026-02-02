// ===================================================================
// Memory Node - Standalone Conversation Memory Management
// ===================================================================

import { registry } from '../../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext } from '../../types/core';
import { RED } from '../../utils';

registry.register('memory', {
  type: 'memory',
  category: 'storage',
  defaults: {
    name: { value: '' },
    action: { value: 'get' },
    scope: { value: 'conversation' },
    key: { value: '' },
    maxItems: { value: 20 },
    ttl: { value: 0 },
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    try {
      const action = node.config.action || 'get';
      const scope = node.config.scope || 'conversation';
      
      // Determine storage key
      let storageKey: string;
      if (scope === 'conversation') {
        const conversationId = node.config.key || msg.conversationId || 'default';
        storageKey = `memory:conversation:${conversationId}`;
      } else if (scope === 'flow') {
        storageKey = `memory:flow:${node.config.key || 'default'}`;
      } else if (scope === 'global') {
        storageKey = `memory:global:${node.config.key || 'default'}`;
      } else {
        throw new Error(`Invalid scope: ${scope}`);
      }

      const storage = scope === 'global' ? context.global : context.flow;

      switch (action) {
        case 'get':
          const data = await storage.get(storageKey) || [];
          msg.memory = data;
          msg.memoryKey = storageKey;
          node.status({ fill: 'green', shape: 'dot', text: `${data.length} items` });
          break;

        case 'set':
          await storage.set(storageKey, msg.payload || []);
          msg.memoryKey = storageKey;
          node.status({ fill: 'green', shape: 'dot', text: 'set' });
          break;

        case 'append':
          const current = await storage.get(storageKey) || [];
          current.push(msg.payload);
          
          // Apply max items limit
          const maxItems = node.config.maxItems || 20;
          const trimmed = current.slice(-maxItems);
          
          await storage.set(storageKey, trimmed);
          msg.memory = trimmed;
          msg.memoryKey = storageKey;
          node.status({ fill: 'green', shape: 'dot', text: `${trimmed.length} items` });
          break;

        case 'prepend':
          const existingData = await storage.get(storageKey) || [];
          existingData.unshift(msg.payload);
          
          // Apply max items limit
          const max = node.config.maxItems || 20;
          const limited = existingData.slice(0, max);
          
          await storage.set(storageKey, limited);
          msg.memory = limited;
          msg.memoryKey = storageKey;
          node.status({ fill: 'green', shape: 'dot', text: `${limited.length} items` });
          break;

        case 'clear':
          await storage.set(storageKey, []);
          msg.memory = [];
          msg.memoryKey = storageKey;
          node.status({ fill: 'grey', shape: 'dot', text: 'cleared' });
          break;

        case 'delete':
          await storage.set(storageKey, undefined);
          msg.memoryKey = storageKey;
          node.status({ fill: 'grey', shape: 'dot', text: 'deleted' });
          break;

        case 'count':
          const items = await storage.get(storageKey) || [];
          msg.payload = items.length;
          msg.memory = items;
          msg.memoryKey = storageKey;
          node.status({ fill: 'blue', shape: 'dot', text: `${items.length} items` });
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      return msg;

    } catch (error: any) {
      node.error(`Memory Error: ${error.message}`, msg);
      node.status({ fill: 'red', shape: 'dot', text: 'error' });
      return null;
    }
  },
  
  ui: {
    icon: '🧠',
    color: '#9B59B6',
    colorLight: '#BB8FCE',
    paletteLabel: 'Memory',
    label: (node) => node.name || `Memory (${node.action})`,
    info: `
      <h3>Memory Node</h3>
      <p>Manage conversation memory and persistent data storage.</p>
      
      <h4>Actions:</h4>
      <ul>
        <li><strong>Get</strong> - Retrieve memory to <code>msg.memory</code></li>
        <li><strong>Set</strong> - Replace entire memory with <code>msg.payload</code></li>
        <li><strong>Append</strong> - Add <code>msg.payload</code> to end</li>
        <li><strong>Prepend</strong> - Add <code>msg.payload</code> to beginning</li>
        <li><strong>Clear</strong> - Empty the memory</li>
        <li><strong>Delete</strong> - Remove memory completely</li>
        <li><strong>Count</strong> - Get number of items in <code>msg.payload</code></li>
      </ul>
      
      <h4>Scopes:</h4>
      <ul>
        <li><strong>Conversation</strong> - Per conversation ID (for chatbots)</li>
        <li><strong>Flow</strong> - Shared within this flow</li>
        <li><strong>Global</strong> - Shared across all flows</li>
      </ul>
      
      <h4>Usage with LLM Agent:</h4>
      <pre>
[http-in] → [memory: get] → [llm-agent] → [memory: append] → [http-response]
      </pre>
    `,
    properties: [
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: '',
        placeholder: 'Conversation Memory',
      },
      {
        name: 'action',
        label: 'Action',
        type: 'select',
        options: [
          { value: 'get', label: 'Get' },
          { value: 'set', label: 'Set' },
          { value: 'append', label: 'Append' },
          { value: 'prepend', label: 'Prepend' },
          { value: 'clear', label: 'Clear' },
          { value: 'delete', label: 'Delete' },
          { value: 'count', label: 'Count' },
        ],
        default: 'get',
        required: true,
      },
      {
        name: 'scope',
        label: 'Scope',
        type: 'select',
        options: [
          { value: 'conversation', label: 'Conversation' },
          { value: 'flow', label: 'Flow' },
          { value: 'global', label: 'Global' },
        ],
        default: 'conversation',
        required: true,
        description: 'Storage scope',
      },
      {
        name: 'key',
        label: 'Key',
        type: 'text',
        default: '',
        placeholder: 'Leave empty to use msg.conversationId',
        description: 'Storage key (or conversation ID)',
      },
      {
        name: 'maxItems',
        label: 'Max Items',
        type: 'number',
        default: 20,
        min: 1,
        max: 1000,
        description: 'Maximum items to keep (for append/prepend)',
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
