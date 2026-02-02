// ===================================================================
// LLM Stream Node - Real-time Streaming Responses
// ===================================================================

import { registry } from '../../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext, FlowConfig } from '../../types/core';
import { ProviderFactory, LLMMessage } from '../../providers/factory';

registry.register('llm-stream', {
  type: 'llm-stream',
  category: 'AI',
  defaults: {
    name: { value: '' },
    llmConfig: { value: '' },
    systemInstruction: { value: '' },
    memoryEnabled: { value: true },
  },
  inputs: 1,
  outputs: 2, // [chunks, complete]
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    try {
      node.status({ fill: 'yellow', shape: 'dot', text: 'streaming' });

      // Get LLM config
      const configNodeId = node.config.llmConfig;
      if (!configNodeId) {
        node.error('LLM Config is required', msg);
        node.status({ fill: 'red', shape: 'dot', text: 'no config' });
        return null;
      }

      // Find config node
      const flowConfig = context.flowEngine?.flowConfig as FlowConfig;
      const configNode = flowConfig?.nodes.find(n => n.id === configNodeId);
      
      if (!configNode) {
        node.error(`Config node ${configNodeId} not found`, msg);
        node.status({ fill: 'red', shape: 'dot', text: 'config not found' });
        return null;
      }

      // Create provider
      const provider = ProviderFactory.create({
        provider: configNode.provider,
        apiKey: configNode.apiKey,
        model: configNode.model,
        baseUrl: configNode.baseUrl,
        temperature: configNode.temperature,
        maxTokens: configNode.maxTokens,
        topP: configNode.topP,
        topK: configNode.topK,
        defaultSystemPrompt: configNode.defaultSystemPrompt,
      });

      // Get conversation ID
      const conversationId = msg.conversationId || msg._msgid || 'default';

      // Load conversation history if memory enabled
      let history: LLMMessage[] = [];
      if (node.config.memoryEnabled) {
        const memoryKey = `llm_history_${conversationId}`;
        history = await node.context().flow.get(memoryKey) || [];
      }

      // Add user message
      const userContent = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload);
      history.push({
        role: 'user',
        content: userContent,
      });

      // Determine system instruction
      const systemInstruction = node.config.systemInstruction || configNode.defaultSystemPrompt || '';

      // Stream response
      const chunks: NodeMessage[] = [];
      let fullText = '';

      const stream = provider.stream({
        model: configNode.model,
        messages: history,
        temperature: configNode.temperature,
        maxTokens: configNode.maxTokens,
        topP: configNode.topP,
        topK: configNode.topK,
        systemInstruction,
      });

      for await (const chunk of stream) {
        if (chunk.content) {
          fullText += chunk.content;
          
          // Send chunk to first output
          const chunkMsg: NodeMessage = {
            ...msg,
            _msgid: crypto.randomUUID(),
            payload: chunk.content,
            chunk: true,
            complete: false,
            conversationId,
          };
          
          chunks.push(chunkMsg);
        }

        if (chunk.done) {
          break;
        }
      }

      // Add assistant response to history
      history.push({
        role: 'assistant',
        content: fullText,
      });

      // Save history if memory enabled
      if (node.config.memoryEnabled) {
        const memoryKey = `llm_history_${conversationId}`;
        const maxItems = 50;
        const trimmedHistory = history.slice(-maxItems);
        await node.context().flow.set(memoryKey, trimmedHistory);
      }

      node.status({ fill: 'green', shape: 'dot', text: 'complete' });

      // Send complete message to second output
      const completeMsg: NodeMessage = {
        ...msg,
        payload: fullText,
        chunk: false,
        complete: true,
        conversationId,
        llm: {
          provider: configNode.provider,
          model: configNode.model,
        },
      };

      return [chunks, completeMsg];

    } catch (error: any) {
      node.error(`LLM Stream Error: ${error.message}`, msg);
      node.status({ fill: 'red', shape: 'dot', text: 'error' });
      
      return [[], {
        ...msg,
        payload: null,
        error: error.message,
        llm: {
          error: error.message,
          provider: error.provider,
        },
      }];
    }
  },
  
  ui: {
    icon: '📡',
    color: '#4A90E2',
    colorLight: '#6AA8F5',
    paletteLabel: 'LLM Stream',
    label: (node) => node.name || 'LLM Stream',
    info: `
      <h3>LLM Stream</h3>
      <p>Stream LLM responses in real-time chunks.</p>
      
      <h4>Features:</h4>
      <ul>
        <li>Real-time streaming output</li>
        <li>Conversation memory support</li>
        <li>Works with all providers that support streaming</li>
      </ul>
      
      <h4>Inputs:</h4>
      <ul>
        <li><code>msg.payload</code> - User message (string)</li>
        <li><code>msg.conversationId</code> - Optional conversation ID</li>
      </ul>
      
      <h4>Outputs:</h4>
      <ol>
        <li><strong>Chunks</strong> - Stream of text chunks as they arrive</li>
        <li><strong>Complete</strong> - Full response when streaming is done</li>
      </ol>
      
      <h4>Use Cases:</h4>
      <ul>
        <li>Real-time chatbot responses</li>
        <li>Progressive UI updates</li>
        <li>Server-Sent Events (SSE)</li>
      </ul>
      
      <h4>Example Flow:</h4>
      <pre>
[http-in] → [llm-stream] → [function: format SSE] → [http-response]
                         ↓
                    [complete] → [memory: save]
      </pre>
    `,
    properties: [
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: '',
        placeholder: 'Streaming Agent',
      },
      {
        name: 'llmConfig',
        label: 'LLM Config',
        type: 'select',
        options: [],
        default: '',
        required: true,
        description: 'Select an LLM Config node',
      },
      {
        name: 'systemInstruction',
        label: 'System Instruction (Override)',
        type: 'textarea',
        rows: 6,
        default: '',
        placeholder: 'Leave empty to use config default...',
        description: 'Override the system prompt from config',
      },
      {
        name: 'memoryEnabled',
        label: 'Enable Memory',
        type: 'checkbox',
        default: true,
        description: 'Store conversation history',
      },
    ],
  },
});
