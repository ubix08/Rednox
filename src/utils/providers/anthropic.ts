// ===================================================================
// Anthropic Claude Provider Implementation
// ===================================================================

import { 
  LLMProvider, 
  ChatParams, 
  ChatResponse, 
  StreamChunk,
  ToolCall,
  LLMMessage,
  LLMError
} from './base';

export class AnthropicProvider extends LLMProvider {
  private readonly apiUrl: string;
  private readonly version: string;

  constructor(apiKey: string, baseUrl?: string, version = '2023-06-01') {
    super(apiKey, baseUrl);
    this.apiUrl = baseUrl || 'https://api.anthropic.com/v1';
    this.version = version;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    try {
      const { system, messages } = this.convertMessages(params.messages, params.systemInstruction);
      const tools = params.tools?.map(tool => this.convertTool(tool));

      const requestBody: any = {
        model: params.model,
        messages,
        max_tokens: params.maxTokens || 4096,
        temperature: params.temperature ?? 1.0,
        top_p: params.topP ?? 1.0,
      };

      if (system) {
        requestBody.system = system;
      }

      if (tools && tools.length > 0) {
        requestBody.tools = tools;
      }

      const response = await fetch(`${this.apiUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': this.version,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        throw new LLMError(
          error.error?.message || 'Anthropic API request failed',
          'anthropic',
          response.status,
          error
        );
      }

      const data = await response.json();

      // Extract text content
      let content = '';
      const textBlocks = data.content.filter((c: any) => c.type === 'text');
      for (const block of textBlocks) {
        content += block.text;
      }

      // Extract tool calls
      let toolCalls: ToolCall[] | undefined;
      const toolUseBlocks = data.content.filter((c: any) => c.type === 'tool_use');
      
      if (toolUseBlocks.length > 0) {
        toolCalls = toolUseBlocks.map((block: any) => ({
          id: block.id,
          type: 'function' as const,
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        }));
      }

      return {
        content,
        toolCalls,
        finishReason: data.stop_reason === 'tool_use' ? 'tool_calls' :
                      data.stop_reason === 'max_tokens' ? 'length' : 'stop',
        usage: {
          promptTokens: data.usage?.input_tokens || 0,
          completionTokens: data.usage?.output_tokens || 0,
          totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        },
        raw: data,
      };
    } catch (error: any) {
      if (error instanceof LLMError) throw error;
      throw new LLMError(
        error.message || 'Anthropic request failed',
        'anthropic',
        undefined,
        error
      );
    }
  }

  async *stream(params: ChatParams): AsyncGenerator<StreamChunk> {
    try {
      const { system, messages } = this.convertMessages(params.messages, params.systemInstruction);
      const tools = params.tools?.map(tool => this.convertTool(tool));

      const requestBody: any = {
        model: params.model,
        messages,
        max_tokens: params.maxTokens || 4096,
        temperature: params.temperature ?? 1.0,
        top_p: params.topP ?? 1.0,
        stream: true,
      };

      if (system) {
        requestBody.system = system;
      }

      if (tools && tools.length > 0) {
        requestBody.tools = tools;
      }

      const response = await fetch(`${this.apiUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': this.version,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        throw new LLMError(
          error.error?.message || 'Anthropic streaming request failed',
          'anthropic',
          response.status,
          error
        );
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let toolCallsBuffer: Record<string, { name: string; input: string }> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'content_block_start') {
              if (data.content_block?.type === 'tool_use') {
                toolCallsBuffer[data.content_block.id] = {
                  name: data.content_block.name,
                  input: '',
                };
              }
            } else if (data.type === 'content_block_delta') {
              if (data.delta?.type === 'text_delta') {
                yield {
                  content: data.delta.text,
                  done: false,
                };
              } else if (data.delta?.type === 'input_json_delta') {
                const blockId = data.index; // Get the current block index
                const keys = Object.keys(toolCallsBuffer);
                if (keys[blockId]) {
                  toolCallsBuffer[keys[blockId]].input += data.delta.partial_json;
                }
              }
            } else if (data.type === 'message_delta') {
              if (data.delta?.stop_reason === 'tool_use') {
                const toolCalls = Object.entries(toolCallsBuffer).map(([id, tc]) => ({
                  id,
                  type: 'function' as const,
                  function: {
                    name: tc.name,
                    arguments: tc.input,
                  },
                }));

                yield {
                  content: '',
                  toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                  done: true,
                };
              }
            } else if (data.type === 'message_stop') {
              yield { content: '', done: true };
            }
          } catch (e) {
            console.error('Error parsing Anthropic SSE line:', e);
          }
        }
      }

      yield { content: '', done: true };
    } catch (error: any) {
      if (error instanceof LLMError) throw error;
      throw new LLMError(
        error.message || 'Anthropic streaming failed',
        'anthropic',
        undefined,
        error
      );
    }
  }

  private convertMessages(messages: LLMMessage[], systemInstruction?: string): {
    system?: string;
    messages: any[];
  } {
    let system = systemInstruction;
    const converted: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Combine system messages
        system = system ? `${system}\n\n${msg.content}` : msg.content;
        continue;
      }

      if (msg.role === 'tool') {
        // Find the last assistant message to append tool result
        const lastAssistantIdx = converted.length - 1;
        if (lastAssistantIdx >= 0 && converted[lastAssistantIdx].role === 'assistant') {
          // Add to existing assistant message
          converted[lastAssistantIdx].content.push({
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: msg.content,
          });
        } else {
          // Create new user message with tool result
          converted.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: msg.content,
            }],
          });
        }
      } else if (msg.role === 'assistant') {
        const content: any[] = [];

        if (msg.content) {
          content.push({
            type: 'text',
            text: msg.content,
          });
        }

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            });
          }
        }

        converted.push({
          role: 'assistant',
          content,
        });
      } else {
        // User message
        converted.push({
          role: 'user',
          content: [{
            type: 'text',
            text: msg.content,
          }],
        });
      }
    }

    return { system, messages: converted };
  }

  private convertTool(tool: any) {
    return {
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    };
  }
}
