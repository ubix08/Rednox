// ===================================================================
// Agent Node - Refactored with Config Node Architecture
// ===================================================================

import { registry } from '../../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext } from '../../types/core';
import { ProviderFactory, LLMMessage, ToolDefinition } from '../../providers/factory';
import { createConfigRegistry } from '../../core/ConfigNodeRegistry';
import { ToolExecutor } from '../../core/ToolExecutor';
import { MemoryManager } from '../../core/MemoryManager';
import { RED } from '../../utils';

registry.register('agent', {
  type: 'agent',
  category: 'AI Agents',
  defaults: {
    name: { value: '' },
    
    // Config node references
    llmProvider: { value: '' },
    memory: { value: '' },
    tools: { value: [] },
    knowledge: { value: [] },
    
    // Agent-specific settings
    systemPrompt: { value: '' },
    messages: { value: [] },
    
    // Behavior
    maxToolCalls: { value: 5 },
    maxIterations: { value: 10 },
    returnResponseAs: { value: 'userMessage' },
    
    // State management
    updateState: { value: [] },
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    try {
      node.status({ fill: 'yellow', shape: 'dot', text: 'processing' });
      
      // Create config registry
      const configRegistry = createConfigRegistry(context);
      
      // 1. Load and validate LLM provider config
      if (!node.config.llmProvider) {
        throw new Error('LLM Provider is required');
      }
      
      const providerConfig = await configRegistry.load(node.config.llmProvider);
      const provider = ProviderFactory.create({
        provider: providerConfig.provider,
        apiKey: providerConfig.apiKey,
        model: providerConfig.model,
        baseUrl: providerConfig.baseUrl,
        temperature: providerConfig.temperature,
        maxTokens: providerConfig.maxTokens,
        topP: providerConfig.topP,
        topK: providerConfig.topK,
        defaultSystemPrompt: providerConfig.defaultSystemPrompt,
      });
      
      // 2. Get conversation ID
      const conversationId = msg.conversationId || msg._msgid || 'default';
      
      // 3. Load memory if configured
      let history: LLMMessage[] = [];
      
      if (node.config.memory) {
        try {
          const memoryConfig = await configRegistry.load(node.config.memory);
          history = await MemoryManager.load(memoryConfig, conversationId, context);
        } catch (error) {
          console.error('[Agent] Error loading memory:', error);
        }
      }
      
      // 4. Add custom messages from config
      if (Array.isArray(node.config.messages)) {
        for (const msgConfig of node.config.messages) {
          // Replace variables in content
          let content = msgConfig.content;
          
          // Replace {{variable}} with msg properties
          content = content.replace(/\{\{([^}]+)\}\}/g, (match: string, path: string) => {
            const value = RED.util.getMessageProperty(msg, path.trim());
            return value !== undefined ? String(value) : match;
          });
          
          history.push({
            role: msgConfig.role,
            content: content
          });
        }
      }
      
      // 5. Add current user message
      const userContent = typeof msg.payload === 'string' 
        ? msg.payload 
        : JSON.stringify(msg.payload);
      
      history.push({
        role: 'user',
        content: userContent
      });
      
      // 6. Load tool configs and create definitions
      let tools: ToolDefinition[] | undefined;
      const toolConfigs: any[] = [];
      
      if (Array.isArray(node.config.tools) && node.config.tools.length > 0) {
        try {
          const loadedTools = await configRegistry.loadMultiple(node.config.tools);
          toolConfigs.push(...loadedTools);
          
          // Create tool definitions for LLM
          tools = loadedTools.map(tc => ({
            type: 'function' as const,
            function: {
              name: tc.toolName,
              description: tc.toolDescription,
              parameters: tc.toolParameters,
            }
          }));
        } catch (error) {
          console.error('[Agent] Error loading tools:', error);
        }
      }
      
      // 7. Determine system instruction
      const systemInstruction = node.config.systemPrompt || providerConfig.defaultSystemPrompt || '';
      
      // 8. Execute agent loop (handle tool calls)
      let iterations = 0;
      const maxIterations = node.config.maxIterations || 10;
      let toolCallCount = 0;
      const maxToolCalls = node.config.maxToolCalls || 5;
      
      while (iterations < maxIterations) {
        iterations++;
        
        // Call LLM
        const response = await provider.chat({
          model: providerConfig.model,
          messages: history,
          tools,
          systemInstruction,
          temperature: providerConfig.temperature,
          maxTokens: providerConfig.maxTokens,
          topP: providerConfig.topP,
          topK: providerConfig.topK,
        });
        
        // Add assistant response to history
        history.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.toolCalls,
        });
        
        // Handle tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          node.status({ fill: 'blue', shape: 'dot', text: `tools: ${response.toolCalls.length}` });
          
          // Check tool call limit
          toolCallCount += response.toolCalls.length;
          if (toolCallCount > maxToolCalls) {
            throw new Error(`Max tool calls exceeded: ${maxToolCalls}`);
          }
          
          // Execute all tool calls
          for (const toolCall of response.toolCalls) {
            try {
              // Find tool config
              const toolConfig = toolConfigs.find(tc => tc.toolName === toolCall.function.name);
              
              if (!toolConfig) {
                throw new Error(`Tool not found: ${toolCall.function.name}`);
              }
              
              // Check if requires approval (future enhancement)
              if (toolConfig.requiresApproval) {
                // TODO: Implement approval workflow
                console.warn('[Agent] Tool requires approval (not implemented):', toolCall.function.name);
              }
              
              // Execute tool
              const toolResult = await ToolExecutor.execute(
                toolCall,
                toolConfig,
                msg,
                context
              );
              
              // Add tool result to history
              history.push({
                role: 'tool',
                name: toolCall.function.name,
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResult)
              });
              
            } catch (error: any) {
              console.error(`[Agent] Tool execution error:`, error);
              
              // Add error to history
              history.push({
                role: 'tool',
                name: toolCall.function.name,
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  error: error.message,
                  success: false
                })
              });
            }
          }
          
          // Continue loop to get next response from LLM
          continue;
        }
        
        // No tool calls - we have final response
        node.status({ fill: 'green', shape: 'dot', text: 'complete' });
        
        // Save to memory
        if (node.config.memory) {
          try {
            const memoryConfig = await configRegistry.load(node.config.memory);
            await MemoryManager.save(memoryConfig, conversationId, history, context);
          } catch (error) {
            console.error('[Agent] Error saving memory:', error);
          }
        }
        
        // Update state if configured
        if (Array.isArray(node.config.updateState)) {
          for (const stateUpdate of node.config.updateState) {
            if (stateUpdate.key && stateUpdate.value !== undefined) {
              await context.flow.set(stateUpdate.key, stateUpdate.value);
            }
          }
        }
        
        // Return response
        const responsePayload = node.config.returnResponseAs === 'assistantMessage'
          ? history[history.length - 1]
          : response.content;
        
        return {
          ...msg,
          payload: responsePayload,
          conversationId,
          llm: {
            provider: providerConfig.provider,
            model: providerConfig.model,
            usage: response.usage,
            finishReason: response.finishReason,
            iterations,
            toolCallCount,
          },
        };
      }
      
      // Max iterations reached
      throw new Error(`Max iterations reached: ${maxIterations}`);
      
    } catch (error: any) {
      node.error(`Agent Error: ${error.message}`, msg);
      node.status({ fill: 'red', shape: 'dot', text: 'error' });
      
      return {
        ...msg,
        payload: null,
        error: error.message,
        llm: {
          error: error.message,
        },
      };
    }
  },
  
  ui: {
    icon: '🤖',
    color: '#4A90E2',
    colorLight: '#6AA8F5',
    paletteLabel: 'Agent',
    label: (node) => node.name || 'Agent',
    
    info: `
      <h3>Agent</h3>
      <p>Intelligent agent with tool calling, memory, and knowledge integration.</p>
      
      <h4>Features:</h4>
      <ul>
        <li>Multi-provider LLM support (OpenAI, Anthropic, Gemini, Groq)</li>
        <li>Automatic tool discovery and execution</li>
        <li>Conversation memory management</li>
        <li>Knowledge base integration</li>
        <li>Multi-step reasoning</li>
      </ul>
      
      <h4>Configuration:</h4>
      <ul>
        <li><strong>LLM Provider</strong> - Select from configured providers</li>
        <li><strong>Tools</strong> - Choose available tools (function, HTTP, OpenAPI)</li>
        <li><strong>Memory</strong> - Configure conversation history management</li>
        <li><strong>Knowledge</strong> - Add document/vector knowledge sources</li>
      </ul>
      
      <h4>Inputs:</h4>
      <ul>
        <li><code>msg.payload</code> - User message (string)</li>
        <li><code>msg.conversationId</code> - Optional conversation ID</li>
      </ul>
      
      <h4>Outputs:</h4>
      <ul>
        <li><code>msg.payload</code> - Agent response</li>
        <li><code>msg.llm</code> - Execution metadata</li>
      </ul>
    `,
    
    properties: [
      {
        name: 'name',
        label: 'Agent Name',
        type: 'text',
        placeholder: 'Customer Support Agent',
        description: 'Friendly name for this agent',
      },
      {
        name: 'llmProvider',
        label: 'LLM Provider',
        type: 'select',
        required: true,
        loadOptions: 'listLLMProviders',
        description: 'Select an LLM provider configuration',
      },
      {
        name: 'systemPrompt',
        label: 'System Prompt',
        type: 'textarea',
        rows: 6,
        placeholder: 'You are a helpful assistant...',
        description: 'Instructions for the agent (overrides provider default)',
      },
      {
        name: 'messages',
        label: 'Additional Messages',
        type: 'json',
        default: [],
        description: 'Array of system/assistant/user messages with variable support',
      },
      {
        name: 'tools',
        label: 'Tools',
        type: 'multiselect',
        loadOptions: 'listToolConfigs',
        default: [],
        description: 'Select tools this agent can use',
      },
      {
        name: 'memory',
        label: 'Memory',
        type: 'select',
        loadOptions: 'listMemoryConfigs',
        description: 'Select memory configuration (optional)',
      },
      {
        name: 'knowledge',
        label: 'Knowledge Sources',
        type: 'multiselect',
        loadOptions: 'listKnowledgeConfigs',
        default: [],
        description: 'Select knowledge bases (optional)',
      },
      {
        name: 'maxToolCalls',
        label: 'Max Tool Calls',
        type: 'number',
        default: 5,
        min: 1,
        max: 20,
        description: 'Maximum tool calls per message',
      },
      {
        name: 'maxIterations',
        label: 'Max Iterations',
        type: 'number',
        default: 10,
        min: 1,
        max: 50,
        description: 'Maximum agent reasoning iterations',
      },
      {
        name: 'returnResponseAs',
        label: 'Return Response As',
        type: 'select',
        options: [
          { value: 'userMessage', label: 'Text Only' },
          { value: 'assistantMessage', label: 'Full Message Object' },
        ],
        default: 'userMessage',
      },
      {
        name: 'updateState',
        label: 'Update Flow State',
        type: 'json',
        default: [],
        description: 'Key-value pairs to update in flow context',
      },
    ],
  },
});
