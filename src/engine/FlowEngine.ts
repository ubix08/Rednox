// src/engine/FlowEngine.ts
import { NodeInstance } from '../nodes/NodeInstance';
import { FlowConfig, ExecutionContext, NodeMessage } from '../types/core';
import { registry } from '../nodes/NodeRegistry';
import { RED } from '../utils/red';

export class FlowEngine {
  private nodes = new Map<string, NodeInstance>();
  private flowConfig: FlowConfig;
  private context: ExecutionContext;
  private httpResponse: NodeMessage | null = null;
  
  constructor(flowConfig: FlowConfig, context: ExecutionContext) {
    this.flowConfig = flowConfig;
    this.context = context;
    this.context.flowEngine = this;
  }
  
  async initialize() {
    this.nodes.clear();
    
    for (const nodeConfig of this.flowConfig.nodes || []) {
      const definition = registry.get(nodeConfig.type);
      if (!definition) continue;
      
      const nodeInstance = new NodeInstance(nodeConfig, this.context);
      this.nodes.set(nodeConfig.id, nodeInstance);
      
      if (definition.onInit) {
        await definition.onInit(nodeInstance, this.context);
      }
    }
  }
  
  async executeNode(nodeId: string, msg: NodeMessage): Promise<NodeMessage | NodeMessage[] | NodeMessage[][] | null> {
    const nodeInstance = this.nodes.get(nodeId);
    if (!nodeInstance) return null;
    
    const definition = registry.get(nodeInstance.type);
    if (!definition) return null;
    
    try {
      const result = await definition.execute(msg, nodeInstance, this.context);
      
      if (result && (result as NodeMessage)._httpResponse) {
        this.httpResponse = result as NodeMessage;
      }
      
      if (result) {
        await this.routeMessage(nodeInstance, result);
      }
      
      return result;
    } catch (err: any) {
      await this.handleNodeError(err, nodeInstance, msg);
      return null;
    }
  }
  
