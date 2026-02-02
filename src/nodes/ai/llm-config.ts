// ===================================================================
// LLM Config Node - Centralized Model Configuration
// ===================================================================

import { registry } from '../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext } from '../types/core';
import { ProviderFactory } from '../providers/factory';

// This is a configuration node - no execution
registry.register('llm-config', {
  type: 'llm-config',
  category: 'config',
  defaults: {
    name: { value: '' },
    provider: { value: 'openai' },
    model: { value: 'gpt-4o-mini' },
    apiKey: { value: '' },
    baseUrl: { value: '' },
    temperature: { value: 1.0 },
    maxTokens: { value: 4096 },
    topP: { value: 1.0 },
    topK: { value: 64 },
    defaultSystemPrompt: { value: '' },
  },
  inputs: 0,
  outputs: 0,
  
  execute: async (msg: NodeMessage) => {
    // Config nodes don't execute
    return msg;
  },
  
  ui: {
    icon: '⚙️',
    color: '#7B68EE',
    colorLight: '#9B88FF',
    paletteLabel: 'LLM Config',
    label: (node) => node.name || `${node.provider} (${node.model})`,
    info: `
      <h3>LLM Config</h3>
      <p>Configure an LLM provider and model for use in LLM Agent nodes.</p>
      
      <h4>Supported Providers:</h4>
      <ul>
        <li><strong>OpenAI</strong> - GPT-4, GPT-3.5</li>
        <li><strong>Anthropic</strong> - Claude 3.5</li>
        <li><strong>Google Gemini</strong> - Gemini 2.0, 1.5</li>
        <li><strong>Groq</strong> - Fast inference (Llama, Mixtral)</li>
        <li><strong>Custom</strong> - OpenAI-compatible APIs</li>
      </ul>
      
      <h4>Usage:</h4>
      <p>Reference this config in an LLM Agent node to use these settings.</p>
    `,
    properties: [
      {
        name: 'name',
        label: 'Config Name',
        type: 'text',
        default: '',
        placeholder: 'My GPT-4 Config',
        description: 'Friendly name for this configuration',
      },
      {
        name: 'provider',
        label: 'Provider',
        type: 'select',
        options: [
          { value: 'openai', label: 'OpenAI' },
          { value: 'anthropic', label: 'Anthropic' },
          { value: 'gemini', label: 'Google Gemini' },
          { value: 'groq', label: 'Groq' },
          { value: 'custom', label: 'Custom (OpenAI-compatible)' },
        ],
        default: 'openai',
        required: true,
        description: 'LLM provider to use',
      },
      {
        name: 'model',
        label: 'Model',
        type: 'select',
        options: [
          // OpenAI
          { value: 'gpt-4o', label: 'GPT-4o' },
          { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
          { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
          { value: 'gpt-4', label: 'GPT-4' },
          { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
          { value: 'o1-preview', label: 'O1 Preview' },
          { value: 'o1-mini', label: 'O1 Mini' },
          // Anthropic
          { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
          { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
          { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
          // Gemini
          { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash (Experimental)' },
          { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
          { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
          { value: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash-8B' },
          // Groq
          { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
          { value: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B' },
          { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
          { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
        ],
        default: 'gpt-4o-mini',
        required: true,
        description: 'Model to use',
      },
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        default: '',
        required: true,
        description: 'API key for the provider',
      },
      {
        name: 'baseUrl',
        label: 'Base URL (Optional)',
        type: 'url',
        default: '',
        placeholder: 'https://api.openai.com/v1',
        description: 'Custom API base URL (for proxies or custom providers)',
      },
      {
        name: 'temperature',
        label: 'Temperature',
        type: 'number',
        default: 1.0,
        min: 0,
        max: 2,
        step: 0.1,
        description: 'Sampling temperature (0 = deterministic, 2 = very random)',
      },
      {
        name: 'maxTokens',
        label: 'Max Tokens',
        type: 'number',
        default: 4096,
        min: 1,
        max: 128000,
        description: 'Maximum tokens in response',
      },
      {
        name: 'topP',
        label: 'Top P',
        type: 'number',
        default: 1.0,
        min: 0,
        max: 1,
        step: 0.01,
        description: 'Nucleus sampling threshold',
      },
      {
        name: 'topK',
        label: 'Top K (Gemini only)',
        type: 'number',
        default: 64,
        min: 1,
        max: 100,
        description: 'Top-K sampling (Gemini)',
      },
      {
        name: 'defaultSystemPrompt',
        label: 'Default System Prompt',
        type: 'textarea',
        rows: 6,
        default: '',
        placeholder: 'You are a helpful assistant...',
        description: 'Default system instruction (can be overridden in agent)',
      },
    ],
  },
});
