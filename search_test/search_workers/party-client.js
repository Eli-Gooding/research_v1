/**
 * PartyKit Client for Search Agent
 * 
 * This client is responsible for:
 * 1. Connecting to the PartyKit server
 * 2. Sending queries and receiving results
 * 3. Handling state updates and notifications
 */

// Define the SearchPartyClient class in the global scope
class SearchPartyClient {
  /**
   * Initialize the PartyKit client
   * @param {string} serverUrl - The URL of the PartyKit server
   * @param {Object} options - Optional settings
   */
  constructor(serverUrl, options = {}) {
    this.serverUrl = serverUrl;
    this.options = {
      roomId: 'searchagent',
      autoReconnect: true,
      reconnectInterval: 2000,
      maxReconnectAttempts: 5,
      apiBaseUrl: null, // If not provided, will be derived from serverUrl
      ...options
    };
    
    // If apiBaseUrl is not provided, derive it from serverUrl
    if (!this.options.apiBaseUrl) {
      // For local development, we use port 8787 for the API
      if (this.serverUrl.includes('localhost')) {
        const serverUrlObj = new URL(this.serverUrl);
        this.options.apiBaseUrl = `${serverUrlObj.protocol}//${serverUrlObj.hostname}:8787`;
      } else {
        // For production, assume API is at the same domain
        this.options.apiBaseUrl = this.serverUrl.replace('/party', '');
      }
    }
    
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.connectionError = null;
    this.listeners = {
      connect: [],
      disconnect: [],
      state: [],
      message: [], // Add a generic message listener
      jobStarted: [],
      categoryStarted: [],
      categoryCompleted: [],
      compilationStarted: [],
      compilationCompleted: [],
      compilationError: [],
      jobStatus: [],
      error: [],
      broadcast: [], // Add a generic broadcast listener
      status: [], // Add a status listener
      category: [], // Add a category listener
      compile: [] // Add a compile listener
    };
    
    // Bind methods to ensure 'this' context is preserved
    this.onMessage = this.onMessage.bind(this);
    this.onClose = this.onClose.bind(this);
    this.onError = this.onError.bind(this);
    this.reconnect = this.reconnect.bind(this);
    
    console.log(`PartyKit client configured with:
    - Party server: ${this.serverUrl}
    - API server: ${this.options.apiBaseUrl}
    - Room ID: ${this.options.roomId}
    `);
    
    // Connect with a slight delay to ensure everything is initialized
    setTimeout(() => this.connect(), 500);
  }
  
  /**
   * Get the connection status
   * @returns {Object} The connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      error: this.connectionError
    };
  }
  
  /**
   * Connect to the PartyKit server
   * @returns {Promise<boolean>} Whether the connection was successful
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        if (this.socket && this.isConnected) {
          console.log('Already connected to PartyKit server');
          resolve(true);
          return;
        }
        
        // Construct the WebSocket URL
        // Make sure we're using the WebSocket protocol (ws:// or wss://)
        let wsUrl = this.serverUrl;
        if (wsUrl.startsWith('http://')) {
          wsUrl = wsUrl.replace('http://', 'ws://');
        } else if (wsUrl.startsWith('https://')) {
          wsUrl = wsUrl.replace('https://', 'wss://');
        } else if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
          wsUrl = 'ws://' + wsUrl;
        }
        
        const url = `${wsUrl}/party/${this.options.roomId}`;
        console.log(`Connecting to PartyKit server at ${url}`);
        
        // Clear any previous connection error
        this.connectionError = null;
        
        // Close existing socket if any
        if (this.socket) {
          try {
            this.socket.close();
          } catch (error) {
            console.error('Error closing existing socket:', error);
          }
        }
        
        // Create a new WebSocket connection
        this.socket = new WebSocket(url);
        
        // Set up one-time listeners for this connection attempt
        const onOpenOnce = () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.connectionError = null;
          console.log('Connected to PartyKit server');
          
          // Send join message
          this.send({
            type: 'join',
            userId: 'client-' + Math.random().toString(36).substring(2, 9)
          });
          
          // Notify listeners
          this._notifyListeners('connect', { reconnected: this.reconnectAttempts > 0 });
          
          resolve(true);
        };
        
        const onErrorOnce = (error) => {
          console.error('Error connecting to PartyKit server:', error);
          this.connectionError = error;
          this._notifyListeners('error', { error: 'Failed to connect to PartyKit server' });
          reject(error);
        };
        
        // Set up the connection event handlers
        this.socket.addEventListener('open', onOpenOnce, { once: true });
        this.socket.addEventListener('error', onErrorOnce, { once: true });
        
        // Set up the regular event handlers
        this.socket.addEventListener('message', this.onMessage);
        this.socket.addEventListener('close', this.onClose);
        this.socket.addEventListener('error', this.onError);
        
        // Set a connection timeout
        const connectionTimeout = setTimeout(() => {
          if (!this.isConnected) {
            console.error('Connection timeout');
            this.connectionError = new Error('Connection timeout');
            this._notifyListeners('error', { error: 'Connection timeout' });
            
            // Close the socket if it's still connecting
            if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
              this.socket.close();
            }
            
            reject(new Error('Connection timeout'));
          }
        }, 10000); // 10 second timeout
        
        // Clear the timeout when connected
        this.socket.addEventListener('open', () => {
          clearTimeout(connectionTimeout);
        }, { once: true });
      } catch (error) {
        console.error('Error setting up PartyKit connection:', error);
        this.connectionError = error;
        this._notifyListeners('error', { error: 'Failed to set up PartyKit connection' });
        reject(error);
      }
    });
  }
  
  /**
   * Disconnect from the PartyKit server
   */
  disconnect() {
    if (this.socket) {
      this.socket.close();
    }
  }
  
  /**
   * Send a message to the PartyKit server
   * @param {Object} message - The message to send
   * @returns {boolean} Whether the message was sent successfully
   */
  send(message) {
    // First check if we have a socket instance
    if (!this.socket) {
      console.warn('No WebSocket instance exists, cannot send message');
      return false;
    }
    
    // Then check the socket's ready state
    if (this.socket.readyState !== WebSocket.OPEN) {
      console.warn(`WebSocket not in OPEN state (current state: ${this.socket.readyState}), cannot send message`);
      
      // Update our connected flag to match reality
      if (this.isConnected) {
        this.isConnected = false;
        this._notifyListeners('disconnect', { reason: 'Socket state mismatch' });
      }
      
      return false;
    }
    
    // Finally check our connected flag
    if (!this.isConnected) {
      console.warn('Not marked as connected to PartyKit server, cannot send message');
      return false;
    }
    
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      this._notifyListeners('error', { error: 'Failed to send message to server' });
      return false;
    }
  }
  
  /**
   * Start a research job
   * @param {string} query - The user's query
   * @param {Object} options - Additional options (e.g., website)
   * @returns {Promise<Object>} The job information
   */
  async startResearch(query, options = {}) {
    try {
      const requestBody = { query, ...options };
      
      console.log(`Starting research via API at ${this.options.apiBaseUrl}/api/query`);
      
      // Check if we're connected to the API
      if (!this.options.apiBaseUrl) {
        throw new Error('API base URL is not configured');
      }
      
      // Make the API request
      const response = await fetch(`${this.options.apiBaseUrl}/api/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      // Parse the response
      const data = await response.json();
      
      // Check for API errors
      if (!response.ok) {
        throw new Error(`API error (${response.status}): ${data.error || response.statusText}`);
      }
      
      // Check for success flag
      if (data && !data.success) {
        throw new Error(data.error || 'Unknown error starting research');
      }
      
      console.log('Research job started successfully:', data);
      return data;
    } catch (error) {
      console.error('Error starting research:', error);
      throw error;
    }
  }
  
  /**
   * Get the status of a job
   * @param {string} jobId - The job ID
   * @returns {Promise<Object>} The job status
   */
  async getJobStatus(jobId) {
    try {
      const response = await fetch(`${this.options.apiBaseUrl}/api/status?jobId=${jobId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error getting job status:', error);
      throw error;
    }
  }
  
  /**
   * Get the results of a job
   * @param {string} jobId - The job ID
   * @param {string} category - Optional category to retrieve (null for full report)
   * @returns {Promise<Object>} The job results
   */
  async getJobResults(jobId, category = null) {
    try {
      let url = `${this.options.apiBaseUrl}/api/result?jobId=${jobId}`;
      if (category) {
        url += `&category=${category}`;
      }
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error getting job results:', error);
      throw error;
    }
  }
  
  /**
   * Request job status update via WebSocket
   * @param {string} jobId - The job ID (optional)
   * @returns {boolean} Whether the message was sent successfully
   */
  requestStatus(jobId = null) {
    // Double-check connection status before attempting to send
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not in OPEN state (current state: ' + 
        (this.socket ? this.socket.readyState : 'undefined') + 
        '), cannot request status');
      this.isConnected = false; // Update connection status to match reality
      return false;
    }
    
    if (!this.isConnected) {
      console.warn('Not marked as connected to PartyKit server, cannot request status');
      return false;
    }
    
    // Create the message payload
    const message = {
      action: 'getStatus',
      jobId
    };
    
    // Attempt to send the message
    try {
      this.socket.send(JSON.stringify(message));
      console.log('Successfully sent status request via WebSocket for jobId:', jobId || 'all jobs');
      return true;
    } catch (error) {
      console.error('Error sending status request:', error);
      return false;
    }
  }
  
  /**
   * Add an event listener
   * @param {string} event - The event name
   * @param {Function} callback - The callback function
   */
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    
    this.listeners[event].push(callback);
    return this;
  }
  
  /**
   * Remove an event listener
   * @param {string} event - The event name
   * @param {Function} callback - The callback function
   */
  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
    
    return this;
  }
  
  /**
   * Notify all listeners of an event
   * @param {string} event - The event name
   * @param {Object} data - The event data
   * @private
   */
  _notifyListeners(event, data = {}) {
    if (this.listeners[event]) {
      for (const callback of this.listeners[event]) {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      }
    }
  }
  
  /**
   * Handle incoming messages from the PartyKit server
   * @param {MessageEvent} event - The message event
   */
  onMessage(event) {
    try {
      const data = JSON.parse(event.data);
      console.log('Received message from PartyKit server:', data);
      
      // Notify all message listeners
      this._notifyListeners('message', data);
      
      // Handle specific message types
      if (data.action) {
        switch (data.action) {
          case 'status':
            this._notifyListeners('status', data);
            this._notifyListeners('jobStatus', data);
            break;
          case 'category':
            this._notifyListeners('category', data);
            if (data.status === 'started') {
              this._notifyListeners('categoryStarted', data);
            } else if (data.status === 'completed') {
              this._notifyListeners('categoryCompleted', data);
            }
            break;
          case 'compile':
            this._notifyListeners('compile', data);
            if (data.status === 'started') {
              this._notifyListeners('compilationStarted', data);
            } else if (data.status === 'completed') {
              this._notifyListeners('compilationCompleted', data);
            } else if (data.status === 'error') {
              this._notifyListeners('compilationError', data);
            }
            break;
          default:
            // For unhandled action types, notify broadcast listeners
            this._notifyListeners('broadcast', data);
            break;
        }
      } else if (data.type === 'state') {
        // Handle state updates
        this._notifyListeners('state', data);
        
        // Extract state data, handling both formats: { state: {...} } and { data: {...} }
        const stateData = data.state || data.data || {};
        
        // Create a status update from the state
        const statusUpdate = {
          action: 'status',
          status: stateData.status || 'pending',
          jobId: stateData.currentJobId,
          categories: stateData.categories || {},
          progress: stateData.progress || { completed: 0, total: 1 }
        };
        
        console.log('Created status update from state:', statusUpdate);
        
        // Notify status listeners
        this._notifyListeners('status', statusUpdate);
        this._notifyListeners('jobStatus', statusUpdate);
      } else if (data.type) {
        // Handle other typed messages
        this._notifyListeners(data.type, data);
      } else {
        // For messages with no action or type, notify broadcast listeners
        this._notifyListeners('broadcast', data);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }
  
  /**
   * Handle connection close event
   * @param {CloseEvent} event - The close event
   */
  onClose(event) {
    this.isConnected = false;
    console.log('Disconnected from PartyKit server:', event.code, event.reason);
    this._notifyListeners('disconnect', event);
    
    // Attempt to reconnect if the connection was closed unexpectedly
    if (event.code !== 1000) {
      this.reconnect();
    }
  }
  
  /**
   * Handle connection error event
   * @param {Event} event - The error event
   */
  onError(event) {
    console.error('PartyKit connection error:', event);
    this._notifyListeners('error', event);
  }
  
  /**
   * Attempt to reconnect to the PartyKit server
   */
  reconnect() {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.error(`Failed to reconnect after ${this.options.maxReconnectAttempts} attempts`);
      this._notifyListeners('error', new Error('Max reconnect attempts reached'));
      return;
    }
    
    this.reconnectAttempts++;
    console.log(`Reconnecting to PartyKit server (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})...`);
    
    setTimeout(() => {
      this.connect()
        .then(() => {
          console.log('Reconnected to PartyKit server');
          this._notifyListeners('connect', { reconnected: true });
        })
        .catch((error) => {
          console.error('Failed to reconnect:', error);
          this.reconnect();
        });
    }, this.options.reconnectInterval * this.reconnectAttempts);
  }
}

// Make the class available globally
window.SearchPartyClient = SearchPartyClient; 