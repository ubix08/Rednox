
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
  
  private async routeMessage(nodeInstance: NodeInstance, result: NodeMessage | NodeMessage[] | NodeMessage[][]) {
    let outputs: NodeMessage[][];
    if (!Array.isArray(result)) {
      outputs = [[result]];
    } else if (!Array.isArray(result[0])) {
      outputs = [result as NodeMessage[]];
    } else {
      outputs = result as NodeMessage[][];
    }

    const wires = this.flowConfig.wires || {};
    const nodeWires = wires[nodeInstance.id] || [];

    for (let outputIndex = 0; outputIndex < nodeWires.length; outputIndex++) {
      const targets = nodeWires[outputIndex] || [];
      const messages = outputs[outputIndex] || [];

      for (const targetId of targets) {
        for (const msg of messages) {
          // Clone the message to avoid shared state issues across branches
          await this.executeNode(targetId, { ...msg });
        }
      }
    }
  }

  private async handleNodeError(err: any, nodeInstance: NodeInstance, msg: NodeMessage) {
    RED.log.error(`Error in node ${nodeInstance.id}: ${err.message}`);
    // Additional error handling can be added here, such as routing to catch nodes
    // For example, find catch nodes connected to this node and route the error message
    // const errorMsg = { ...msg, error: err };
    // await this.routeToCatchNodes(nodeInstance, errorMsg);
  }

  // Optional getter for httpResponse if needed externally
  getHttpResponse(): NodeMessage
