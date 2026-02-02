// ===================================================================
// LLM Agent Node - Universal Agent with Tool Calling
// ===================================================================


import { registry } from '../../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext, FlowConfig } from '../../types/core';
import { ProviderFactory, LLMMessage, ToolDefinition } from '../../providers/factory';
import { RED } from '../../utils';

registry.register('llm-agent', {
  type: 'llm-agent',
  category: 'AI',
  defaults: {
    name: { value: '' },
    llmConfig: { value: '' },
    systemInstruction: { value: '' },
    memoryEnabled: { value: true },
    toolsEnabled: { value: true },
    maxToolCalls: { value: 5 },
  },
  inputs: 1,
  outputs: 2, // [normal output, tool call output]
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    try {
      node.status({ fill: 'yellow', shape: 'dot', text: 'processing' });

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

      // Handle incoming tool results
      if (msg.toolResult) {
        // This is a tool result coming back to the agent
        const toolCall = msg._toolCall;
        if (toolCall) {
          history.push({
            role: 'tool',
            name: toolCall.function.name,
            tool_call_id: toolCall.id,
            content: JSON.stringify(msg.toolResult),
          });
        }
      } else {
        // This is a new user message
        const userContent = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload);
        history.push({
          role: 'user',
          content: userContent,
        });
      }

      // Discover available tools if enabled
      let tools: ToolDefinition[] | undefined;
      if (node.config.toolsEnabled) {
        tools = await discoverTools(node, context);
      }

      // Determine system instruction
      const systemInstruction = node.config.systemInstruction || configNode.defaultSystemPrompt || '';

      // Call LLM
      const response = await provider.chat({
        model: configNode.model,
        messages: history,
        tools,
        temperature: configNode.temperature,
        maxTokens: configNode.maxTokens,
        topP: configNode.topP,
        topK: configNode.topK,
        systemInstruction,
      });

      // Add assistant response to history
      history.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.toolCalls,
      });

      // Save history if memory enabled
      if (node.config.memoryEnabled) {
        const memoryKey = `llm_history_${conversationId}`;
        const maxItems = 50; // Keep last 50 messages
        const trimmedHistory = history.slice(-maxItems);
        await node.context().flow.set(memoryKey, trimmedHistory);
      }

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        node.status({ fill: 'blue', shape: 'dot', text: 'tool calls' });

        // Prepare tool call messages for routing
        const toolCallMsgs = response.toolCalls.map(tc => ({
          ...msg,
          _msgid: crypto.randomUUID(),
          conversationId,
          toolCall: {
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          },
          _toolCall: tc, // Store original for response routing
          _originalMsgId: msg._msgid,
        }));

        return [null, toolCallMsgs]; // Route to tool nodes via output 2
      }

      // Normal text response
      node.status({ fill: 'green', shape: 'dot', text: 'complete' });

      return [{
        ...msg,
        payload: response.content,
        conversationId,
        llm: {
          provider: configNode.provider,
          model: configNode.model,
          usage: response.usage,
          finishReason: response.finishReason,
        },
      }, null];

    } catch (error: any) {
      node.error(`LLM Agent Error: ${error.message}`, msg);
      node.status({ fill: 'red', shape: 'dot', text: 'error' });
      
      return [{
        ...msg,
        payload: null,
        error: error.message,
        llm: {
          error: error.message,
          provider: error.provider,
        },
      }, null];
    }
  },
  
  ui: {
    icon: '🤖',
    color: '#4A90E2',
    colorLight: '#6AA8F5',
    paletteLabel: 'LLM Agent',
    label: (node) => node.name || 'LLM Agent',
    info: `
      <h3>LLM Agent</h3>
      <p>Universal LLM agent with tool calling and memory support.</p>
      
      <h4>Features:</h4>
      <ul>
        <li>Multi-provider support (OpenAI, Anthropic, Gemini, Groq)</li>
        <li>Automatic tool discovery and calling</li>
        <li>Conversation memory</li>
        <li>Streaming support (via separate node)</li>
      </ul>
      
      <h4>Inputs:</h4>
      <ul>
        <li><code>msg.payload</code> - User message (string)</li>
        <li><code>msg.conversationId</code> - Optional conversation ID for memory</li>
        <li><code>msg.toolResult</code> - Tool execution result (from tool nodes)</li>
      </ul>
      
      <h4>Outputs:</h4>
      <ol>
        <li>Text response - Normal LLM output</li>
        <li>Tool calls - Routes to connected tool nodes</li>
      </ol>
      
      <h4>Tool Calling Flow:</h4>
      <pre>
User Message → LLM Agent → [Tool Call] → Tool Node → [Result] → LLM Agent → Response
      </pre>
    `,
    properties: [
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: '',
        placeholder: 'My Agent',
      },
      {
        name: 'llmConfig',
        label: 'LLM Config',
        type: 'select',
        options: [], // Populated dynamically from available config nodes
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
      {
        name: 'toolsEnabled',
        label: 'Enable Tools',
        type: 'checkbox',
        default: true,
        description: 'Allow the agent to call tools',
      },
      {
        name: 'maxToolCalls',
        label: 'Max Tool Calls per Message',
        type: 'number',
        default: 5,
        min: 1,
        max: 20,
        description: 'Limit tool calls to prevent loops',
      },
    ],
  },
});

// ===================================================================
// Tool Discovery Helper
// ===================================================================

async function discoverTools(node: Node, context: ExecutionContext): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];
  
  // Get all nodes in the flow
  const flowConfig = context.flowEngine?.flowConfig as FlowConfig;
  if (!flowConfig) return tools;

  // Find all nodes connected to our second output (tool call output)
  const connectedNodeIds = node.config.wires[1] || [];
  
  for (const nodeId of connectedNodeIds) {
    const targetNode = flowConfig.nodes.find(n => n.id === nodeId);
    if (!targetNode) continue;

    // Check if it's a tool node
    if (targetNode.type === 'function-tool' || targetNode.type === 'http-tool') {
      const toolDef: ToolDefinition = {
        type: 'function',
        function: {
          name: targetNode.toolName || targetNode.name || targetNode.id,
          description: targetNode.toolDescription || targetNode.description || 'No description',
          parameters: targetNode.toolParameters || {
            type: 'object',
            properties: {},
          },
        },
      };
      
      tools.push(toolDef);
    }
  }

  return tools;
}
