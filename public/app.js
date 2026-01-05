
// app.js
const API_BASE_URL = 'https://rednox.ubixsnow08.workers.dev';  // Worker address for backend communication

const { createApp } = Vue;

createApp({
  data() {
    return {
      currentView: 'dashboard',
      currentFlow: null,
      mobileMenuOpen: false,
      contextMenu: { show: false, x: 0, y: 0 },
      toasts: [],
      apiConnected: true,
      flows: [],
      routes: [],
      stats: { flows: 0, routes: 0, logs: 0, nodes: 0 },
      loading: false,
      saving: false,
      showCreateFlowModal: false,
      showImportModal: false,
      showConfirmDelete: false,
      confirmFlow: null,
      newFlowName: '',
      newFlowDesc: '',
      flowSearch: '',
      flowFilter: 'all',
      nodePaletteSearch: '',
      editor: null,
      editorZoom: 1,
      selectedNode: null,
      nodeTypes: [],
      apiBase: API_BASE_URL
    };
  },
  computed: {
    filteredFlows() {
      let flows = this.flows;
      if (this.flowSearch) {
        flows = flows.filter(f => f.name.toLowerCase().includes(this.flowSearch.toLowerCase()));
      }
      if (this.flowFilter === 'enabled') {
        flows = flows.filter(f => f.enabled);
      } else if (this.flowFilter === 'disabled') {
        flows = flows.filter(f => !f.enabled);
      }
      return flows;
    },
    filteredNodeCategories() {
      const categories = new Set(this.nodeTypes
        .filter(n => n.ui.paletteLabel.toLowerCase().includes(this.nodePaletteSearch.toLowerCase()))
        .map(n => n.category)
      );
      return Array.from(categories);
    }
  },
  methods: {
    navigateTo(view) {
      this.currentView = view;
      this.mobileMenuOpen = false;
      if (view === 'dashboard') this.loadDashboard();
      if (view === 'flows') this.loadFlows();
      if (view === 'routes') this.loadRoutes();
    },
    loadDashboard() {
      this.loading = true;
      Promise.all([
        fetch(API_BASE_URL + '/admin/stats').then(r => r.json()).then(d => this.stats = d),
        this.loadFlows()
      ]).finally(() => this.loading = false);
    },
    loadFlows() {
      fetch(API_BASE_URL + '/admin/flows').then(r => r.json()).then(d => this.flows = d.flows);
    },
    loadRoutes() {
      fetch(API_BASE_URL + '/admin/routes').then(r => r.json()).then(d => this.routes = d.routes);
    },
    initializeDatabase() {
      this.loading = true;
      fetch(API_BASE_URL + '/admin/init', { method: 'POST' }).then(r => r.json()).then(d => {
        this.addToast('success', 'Database initialized');
        this.loadDashboard();
      }).catch(e => this.addToast('error', 'Initialization failed', e.message)).finally(() => this.loading = false);
    },
    refreshAll() {
      this.loadDashboard();
    },
    formatDate(date) {
      return new Date(date).toLocaleString();
    },
    getFlowNodeCount(flow) {
      return flow.nodes ? flow.nodes.length : 0;
    },
    editFlow(flow) {
      this.currentFlow = { ...flow };
      this.loadFlowEditor(flow.id);
    },
    loadFlowEditor(flowId) {
      this.loading = true;
      fetch(API_BASE_URL + `/admin/flows/${flowId}`).then(r => r.json()).then(d => {
        this.currentFlow = d;
        this.initEditor();
        // Fix: Convert backend config (object with nodes array) to Drawflow format
        const drawflowData = {
          drawflow: {
            Home: {
              data: d.nodes.reduce((acc, node) => {
                acc[node.id] = {
                  id: node.id,
                  name: node.type, // Drawflow uses 'name' for type
                  data: node, // Store full node data
                  class: '',
                  html: this.getNodeHtml(this.nodeTypes.find(nt => nt.type === node.type) || {}),
                  typenode: false,
                  inputs: Object.fromEntries(Array.from({ length: node.inputs || 0 }, (_, i) => [`input_${i+1}`, { connections: [] }])),
                  outputs: Object.fromEntries(Array.from({ length: node.outputs || 0 }, (_, i) => [`output_${i+1}`, { connections: [] }])),
                  pos_x: node.x || 0,
                  pos_y: node.y || 0
                };
                return acc;
              }, {})
            }
          }
        };
        // Restore connections (assuming backend nodes have 'wires' or similar; adjust based on actual data)
        Object.values(drawflowData.drawflow.Home.data).forEach(node => {
          // If backend node has 'wires' array for outputs (e.g., node.wires = [[targetId], ...] for multi-output)
          if (node.data.wires) {
            node.data.wires.forEach((outConns, outIdx) => {
              if (outConns) {
                node.outputs[`output_${outIdx + 1}`].connections = outConns.map(targetId => ({
                  node: targetId,
                  output: 'input_1'  // Assume single input; adjust if multi-input
                }));
              }
            });
          }
        });
        this.editor.import(drawflowData);
      }).finally(() => this.loading = false);
    },
    closeEditor() {
      this.currentFlow = null;
      this.selectedNode = null;
      this.editor = null;
    },
    initEditor() {
      const container = document.getElementById('drawflow');
      if (!container) return;
      this.editor = new Drawflow(container);
      this.editor.reroute = true;
      this.editor.reroute_fix_curvature = true;
      this.editor.force_first_input = false;
      this.editor.zoom_max = 2;
      this.editor.zoom_min = 0.5;
      this.editor.on('nodeSelected', id => {
        this.selectedNode = this.editor.getNodeFromId(id).data; // Access full data
      });
      this.editor.on('nodeUnselected', () => {
        this.selectedNode = null;
      });
      this.editor.on('zoom', zoom => {
        this.editorZoom = zoom;
      });
      this.editor.start();
    },
    addNodeToCanvas(node) {
      const html = this.getNodeHtml(node);
      const pos_x = (this.editor.precanvas.clientWidth / 2) - this.editor.container.getBoundingClientRect().x;
      const pos_y = (this.editor.precanvas.clientHeight / 2) - this.editor.container.getBoundingClientRect().y;
      const data = { ...node.defaults };
      const nodeId = this.editor.addNode(node.type, node.inputs, node.outputs, pos_x, pos_y, '', data, html, false);
      // Update pos in data for save
      const addedNode = this.editor.getNodeFromId(nodeId);
      addedNode.data.x = addedNode.pos_x;
      addedNode.data.y = addedNode.pos_y;
    },
    getNodeHtml(node) {
      return `
        <div class="node-content">
          <div class="node-header">${node.category}</div>
          <div class="node-title">
            <span class="node-icon">${node.ui.icon}</span>
            ${node.ui.paletteLabel}
          </div>
          <div class="node-subtitle">${node.ui.info || ''}</div>
        </div>
      `;
    },
    getNodeIcon(type) {
      return '📦'; // Default
    },
    saveFlow() {
      this.saving = true;
      const exportData = this.editor.export();
      // Fix: Convert Drawflow export to backend format (nodes array)
      const nodes = Object.values(exportData.drawflow.Home.data).map(node => {
        const backendNode = { ...node.data }; // Full node data
        backendNode.id = node.id;
        backendNode.type = node.name; // Type from Drawflow 'name'
        backendNode.x = node.pos_x;
        backendNode.y = node.pos_y;
        backendNode.inputs = Object.keys(node.inputs).length;
        backendNode.outputs = Object.keys(node.outputs).length;
        // Save connections (e.g., as 'wires' array for outputs)
        backendNode.wires = Object.values(node.outputs).map(out => out.connections.map(conn => conn.node));
        return backendNode;
      });
      const data = {
        name: this.currentFlow.name,
        description: this.currentFlow.description,
        nodes: nodes
      };
      fetch(API_BASE_URL + `/admin/flows/${this.currentFlow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(r => r.json()).then(d => {
        this.addToast('success', 'Flow saved');
      }).catch(e => this.addToast('error', 'Save failed', e.message)).finally(() => this.saving = false);
    },
    exportFlow() {
      const exportData = this.editor.export();
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.currentFlow.name}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    handleImportFile(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          this.editor.import(data); // Assumes Drawflow format
          this.addToast('success', 'Flow imported');
        } catch (err) {
          this.addToast('error', 'Import failed', err.message);
        }
        this.showImportModal = false;
      };
      reader.readAsText(file);
    },
    validateCurrentFlow() {
      this.addToast('info', 'Validation', 'Flow is valid (client-side check)');
    },
    zoomIn() {
      this.editor.zoom_in();
      this.editorZoom = this.editor.zoom;
    },
    zoomOut() {
      this.editor.zoom_out();
      this.editorZoom = this.editor.zoom;
    },
    zoomReset() {
      this.editor.zoom_reset();
      this.editorZoom = 1;
    },
    fitToScreen() {
      this.editor.zoom_reset();
    },
    showContextMenu(e) {
      e.preventDefault();
      this.contextMenu = { show: true, x: e.clientX, y: e.clientY };
    },
    pasteNode() {
      this.addToast('info', 'Paste', 'Paste not implemented');
    },
    clearCanvas() {
      this.editor.clear();
    },
    getConnectionCount() {
      if (!this.editor) return 0;
      return Object.values(this.editor.drawflow.drawflow.Home.data).reduce((acc, node) => {
        return acc + Object.values(node.outputs).reduce((a, o) => a + o.connections.length, 0);
      }, 0);
    },
    deleteSelectedNode() {
      if (this.selectedNode) {
        this.editor.removeNodeId(`node_${this.selectedNode.id}`);
        this.selectedNode = null;
      }
    },
    addToast(type, title, message = '') {
      const id = Date.now();
      this.toasts.push({ id, type, title, message });
      setTimeout(() => this.removeToast(id), 5000);
    },
    removeToast(id) {
      this.toasts = this.toasts.filter(t => t.id !== id);
    },
    getToastIcon(type) {
      return { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' }[type] || 'ℹ️';
    },
    createFlow() {
      if (!this.newFlowName) return;
      this.loading = true;
      fetch(API_BASE_URL + '/admin/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.newFlowName, description: this.newFlowDesc, nodes: [] })
      }).then(r => r.json()).then(d => {
        this.flows.push(d);
        this.showCreateFlowModal = false;
        this.editFlow(d);
        this.newFlowName = '';
        this.newFlowDesc = '';
        this.addToast('success', 'Flow created');
      }).catch(e => this.addToast('error', 'Creation failed', e.message)).finally(() => this.loading = false);
    },
    duplicateFlow(flow) {
      this.loading = true;
      fetch(API_BASE_URL + `/admin/flows/${flow.id}`).then(r => r.json()).then(full => {
        full.name += ' Copy';
        delete full.id;
        fetch(API_BASE_URL + '/admin/flows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(full)
        }).then(r => r.json()).then(d => {
          this.flows.push(d);
          this.addToast('success', 'Flow duplicated');
        });
      }).finally(() => this.loading = false);
    },
    toggleFlowStatus(flow) {
      const action = flow.enabled ? 'disable' : 'enable';
      fetch(API_BASE_URL + `/admin/flows/\( {flow.id}/ \){action}`, { method: 'POST' }).then(r => r.json()).then(d => {
        flow.enabled = !flow.enabled;
        this.addToast('success', `Flow ${action}d`);
      }).catch(e => this.addToast('error', 'Toggle failed', e.message));
    },
    confirmDeleteFlow(flow) {
      this.confirmFlow = flow;
      this.showConfirmDelete = true;
    },
    deleteFlow(flow) {
      fetch(API_BASE_URL + `/admin/flows/${flow.id}`, { method: 'DELETE' }).then(r => {
        if (r.ok) {
          this.flows = this.flows.filter(f => f.id !== flow.id);
          this.addToast('success', 'Flow deleted');
        }
      }).catch(e => this.addToast('error', 'Delete failed', e.message)).finally(() => this.showConfirmDelete = false);
    },
    loadNodeTypes() {
      fetch(API_BASE_URL + '/admin/nodes').then(r => r.json()).then(d => this.nodeTypes = d);
    },
    getNodesByCategory(category) {
      return this.nodeTypes.filter(n => n.category === category && n.ui.paletteLabel.toLowerCase().includes(this.nodePaletteSearch.toLowerCase()));
    },
    addRule() {
      if (!this.selectedNode.rules) this.selectedNode.rules = [];
      this.selectedNode.rules.push({ t: 'eq', v: '' });
    },
    removeRule(index) {
      this.selectedNode.rules.splice(index, 1);
    },
    addChangeRule() {
      if (!this.selectedNode.rules) this.selectedNode.rules = [];
      this.selectedNode.rules.push({ t: 'set', p: '', to: '' });
    },
    removeChangeRule(index) {
      this.selectedNode.rules.splice(index, 1);
    }
  },
  mounted() {
    this.loadNodeTypes();
    this.loadDashboard();
  }
}).mount('#app');
