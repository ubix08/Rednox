
// ===================================================================
// RedNox - Flow Engine
// ===================================================================

import { NodeInstance } from './NodeInstance';
import { registry } from './NodeRegistry';
import { RED } from '../utils';
import { FlowConfig, ExecutionContext, NodeMessage } from '../types/core';

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
  
  async executeNode(
    nodeId: string,
    msg: NodeMessage
  ): Promise<NodeMessage | NodeMessage[] | NodeMessage[][] | null> {
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
  
  async routeMessage(
    sourceNode: NodeInstance,
    msg: NodeMessage | NodeMessage[] | NodeMessage[][]
  ) {
    const wires = sourceNode.config.wires;
    if (!wires || wires.length === 0) return;
    
    if (Array.isArray(msg)) {
      const promises: Promise<any>[] = [];
      for (let outputIdx = 0; outputIdx < msg.length; outputIdx++) {
        const outputMsg = msg[outputIdx];
        const targetWires = wires[outputIdx] || [];
        
        if (outputMsg === null || outputMsg === undefined) continue;
        
        if (Array.isArray(outputMsg)) {
          for (const singleMsg of outputMsg) {
            if (singleMsg) {
              for (const targetNodeId of targetWires) {
                promises.push(
                  this.executeNode(targetNodeId, RED.util.cloneMessage(singleMsg))
                );
              }
            }
          }
        } else {
          for (const targetNodeId of targetWires) {
            promises.push(
              this.executeNode(targetNodeId, RED.util.cloneMessage(outputMsg))
            );
          }
        }
      }
      await Promise.all(promises);
    } else {
      const targetWires = wires[0] || [];
      await Promise.all(
        targetWires.map(nodeId => 
          this.executeNode(nodeId, RED.util.cloneMessage(msg))
        )
      );
    }
  }
  
  async handleNodeError(error: Error, sourceNode: NodeInstance, msg?: NodeMessage) {
    console.error(`Node error [${sourceNode.id}]:`, error);
  }
  
  async triggerFlow(
    entryNodeId: string,
    initialMsg?: NodeMessage
  ): Promise<NodeMessage | null> {
    this.httpResponse = null;
    const msg = initialMsg || {
      _msgid: crypto.randomUUID(),
      payload: {},
      topic: ''
    };
    await this.executeNode(entryNodeId, msg);
    return this.httpResponse;
  }
}
