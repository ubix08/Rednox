/**
 * RedNox - Main Application Controller
 * Orchestrates all modules and initializes the application
 */

(function() {
  'use strict';

  // Application state
  const app = {
    initialized: false,
    currentView: 'flows', // 'flows' | 'canvas'
    currentFlow: null,
    editor: null,
    nodeDefinitions: {},
    flows: [],
    history: {
      past: [],
      future: []
    }
  };

  // Make app globally accessible
  window.RedNox = app;

  /**
   * Initialize application
   */
  async function init() {
    if (app.initialized) return;

    try {
      // Show loading state
      UI.showLoading();

      // Load node definitions first
      await Nodes.loadDefinitions();
      
      // Load flows
      await Flows.loadFlows();
      
      // Initialize canvas (but don't show it)
      Canvas.init();
      
      // Setup event listeners
      setupEventListeners();
      
      // Setup keyboard shortcuts
      Shortcuts.init();
      
      // Mark as initialized
      app.initialized = true;
      
      // Show flows view
      showFlowsView();
      
      UI.hideLoading();
      
      console.log('[RedNox] Application initialized successfully');
    } catch (error) {
      console.error('[RedNox] Initialization failed:', error);
      UI.showToast('Failed to initialize application', 'error');
      UI.hideLoading();
    }
  }

  /**
   * Setup global event listeners
   */
  function setupEventListeners() {
    // Header buttons
    document.getElementById('backBtn').addEventListener('click', showFlowsView);
    document.getElementById('newFlowBtn').addEventListener('click', showNewFlowModal);
    
    // Flow search
    document.getElementById('flowSearch').addEventListener('input', (e) => {
      Flows.filterFlows(e.target.value);
    });
    
    // Node palette
    document.getElementById('closePaletteBtn').addEventListener('click', UI.closeNodePalette);
    document.getElementById('nodeSearch').addEventListener('input', (e) => {
      Nodes.filterNodes(e.target.value);
    });
    
    // Properties panel
    document.getElementById('closePropertiesBtn').addEventListener('click', UI.closeProperties);
    
    // Canvas toolbar
    document.getElementById('addNodeBtn').addEventListener('click', UI.showNodePalette);
    document.getElementById('zoomInBtn').addEventListener('click', () => Canvas.zoom('in'));
    document.getElementById('zoomOutBtn').addEventListener('click', () => Canvas.zoom('out'));
    document.getElementById('zoomResetBtn').addEventListener('click', () => Canvas.zoom('reset'));
    document.getElementById('undoBtn').addEventListener('click', History.undo);
    document.getElementById('redoBtn').addEventListener('click', History.redo);
    document.getElementById('validateBtn').addEventListener('click', Validation.validateFlow);
    document.getElementById('helpBtn').addEventListener('click', showHelpModal);
    
    // New flow modal
    document.getElementById('closeNewFlowModal').addEventListener('click', closeNewFlowModal);
    document.getElementById('cancelNewFlowBtn').addEventListener('click', closeNewFlowModal);
    document.getElementById('newFlowForm').addEventListener('submit', handleNewFlowSubmit);
    
    // Help modal
    document.getElementById('closeHelpModal').addEventListener('click', closeHelpModal);
    
    // Validation panel
    document.getElementById('closeValidationBtn').addEventListener('click', () => {
      document.getElementById('validationPanel').classList.remove('active');
    });
    
    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          closeAllModals();
        }
      });
    });
    
    // Prevent default drag behavior
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
  }

  /**
   * Show flows list view
   */
  function showFlowsView() {
    app.currentView = 'flows';
    app.currentFlow = null;
    
    document.getElementById('flowsView').classList.add('active');
    document.getElementById('canvasView').classList.remove('active');
    document.getElementById('backBtn').classList.remove('visible');
    document.getElementById('flowTitle').textContent = '';
    
    // Update header actions
    document.getElementById('headerActions').innerHTML = `
      <button class="btn btn-primary" id="newFlowBtn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        <span>New Flow</span>
      </button>
    `;
    
    // Re-attach event listener
    document.getElementById('newFlowBtn').addEventListener('click', showNewFlowModal);
    
    UI.closeProperties();
    UI.closeNodePalette();
    
    Flows.renderFlowsList();
  }

  /**
   * Show canvas view for editing a flow
   */
  function showCanvasView(flow) {
    app.currentView = 'canvas';
    app.currentFlow = flow;
    
    document.getElementById('flowsView').classList.remove('active');
    document.getElementById('canvasView').classList.add('active');
    document.getElementById('backBtn').classList.add('visible');
    document.getElementById('flowTitle').textContent = flow.name;
    
    // Update header actions
    document.getElementById('headerActions').innerHTML = `
      <button class="btn btn-success" id="saveFlowBtn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
        <span>Save</span>
      </button>
    `;
    
    // Re-attach event listener
    document.getElementById('saveFlowBtn').addEventListener('click', Flows.saveFlow);
    
    // Load flow into canvas
    Canvas.importFlow(flow);
  }

  /**
   * Show new flow modal
   */
  function showNewFlowModal() {
    document.getElementById('newFlowModal').classList.add('active');
    document.getElementById('newFlowId').focus();
  }

  /**
   * Close new flow modal
   */
  function closeNewFlowModal() {
    document.getElementById('newFlowModal').classList.remove('active');
    document.getElementById('newFlowForm').reset();
  }

  /**
   * Show help modal
   */
  function showHelpModal() {
    document.getElementById('helpModal').classList.add('active');
  }

  /**
   * Close help modal
   */
  function closeHelpModal() {
    document.getElementById('helpModal').classList.remove('active');
  }

  /**
   * Close all modals
   */
  function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
      modal.classList.remove('active');
    });
  }

  /**
   * Handle new flow form submission
   */
  async function handleNewFlowSubmit(e) {
    e.preventDefault();
    
    const id = document.getElementById('newFlowId').value.trim();
    const name = document.getElementById('newFlowName').value.trim();
    const description = document.getElementById('newFlowDesc').value.trim();
    
    if (!id || !name) {
      UI.showToast('Flow ID and Name are required', 'error');
      return;
    }
    
    // Validate ID format
    if (!/^[a-z0-9-]+$/.test(id)) {
      UI.showToast('Flow ID must contain only lowercase letters, numbers, and hyphens', 'error');
      return;
    }
    
    try {
      UI.showLoading();
      
      const flowConfig = {
        id,
        name,
        description,
        version: '1.0.0',
        nodes: []
      };
      
      const result = await API.createFlow(flowConfig);
      
      if (result.success) {
        UI.showToast('Flow created successfully', 'success');
        closeNewFlowModal();
        await Flows.loadFlows();
        
        // Open the new flow
        const newFlow = app.flows.find(f => f.id === id);
        if (newFlow) {
          Flows.openFlow(newFlow);
        }
      } else {
        UI.showToast(result.error || 'Failed to create flow', 'error');
      }
    } catch (error) {
      console.error('[RedNox] Failed to create flow:', error);
      UI.showToast('Failed to create flow', 'error');
    } finally {
      UI.hideLoading();
    }
  }

  /**
   * History management
   */
  const History = {
    /**
     * Save current state to history
     */
    saveState() {
      if (!app.editor || !app.currentFlow) return;
      
      const state = Canvas.exportFlow();
      app.history.past.push(JSON.stringify(state));
      app.history.future = []; // Clear future when new change is made
      
      // Limit history size
      if (app.history.past.length > 50) {
        app.history.past.shift();
      }
      
      this.updateButtons();
    },
    
    /**
     * Undo last change
     */
    undo() {
      if (app.history.past.length === 0) return;
      
      const currentState = Canvas.exportFlow();
      app.history.future.push(JSON.stringify(currentState));
      
      const previousState = app.history.past.pop();
      Canvas.importFlow(JSON.parse(previousState));
      
      this.updateButtons();
      UI.showToast('Undo', 'info');
    },
    
    /**
     * Redo last undone change
     */
    redo() {
      if (app.history.future.length === 0) return;
      
      const currentState = Canvas.exportFlow();
      app.history.past.push(JSON.stringify(currentState));
      
      const nextState = app.history.future.pop();
      Canvas.importFlow(JSON.parse(nextState));
      
      this.updateButtons();
      UI.showToast('Redo', 'info');
    },
    
    /**
     * Update undo/redo button states
     */
    updateButtons() {
      const undoBtn = document.getElementById('undoBtn');
      const redoBtn = document.getElementById('redoBtn');
      
      if (undoBtn) {
        undoBtn.disabled = app.history.past.length === 0;
      }
      
      if (redoBtn) {
        redoBtn.disabled = app.history.future.length === 0;
      }
    },
    
    /**
     * Clear history
     */
    clear() {
      app.history.past = [];
      app.history.future = [];
      this.updateButtons();
    }
  };

  // Expose key functions globally
  window.RedNox.showFlowsView = showFlowsView;
  window.RedNox.showCanvasView = showCanvasView;
  window.RedNox.History = History;

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
