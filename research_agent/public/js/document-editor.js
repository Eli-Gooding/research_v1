/**
 * Collaborative Document Editor
 * 
 * This script handles real-time collaborative editing using PartyKit.
 * It connects to a document party, synchronizes content between users,
 * and provides status updates.
 */

class DocumentEditor {
  constructor(options = {}) {
    // DOM elements
    this.editorElement = options.editorElement || document.getElementById('editor');
    this.statusElement = options.statusElement || document.getElementById('status');
    this.statusIndicator = options.statusIndicator || document.getElementById('status-indicator');
    this.usersElement = options.usersElement || document.getElementById('users');
    
    // Editor state
    this.content = '';
    this.version = 0;
    this.lastSyncedVersion = 0;
    this.isTyping = false;
    this.typingTimeout = null;
    this.connected = false;
    this.documentId = options.documentId || 'default';
    this.userId = this.generateUserId();
    this.users = new Map();
    
    // PartyKit connection
    this.connection = null;
    
    // Initialize
    this.init();
  }
  
  /**
   * Initialize the editor
   */
  init() {
    // Connect to PartyKit
    this.connect();
    
    // Set up event listeners
    this.editorElement.addEventListener('input', this.handleInput.bind(this));
    this.editorElement.addEventListener('keydown', this.handleKeyDown.bind(this));
    this.editorElement.addEventListener('blur', this.handleBlur.bind(this));
    
    // Handle window events
    window.addEventListener('beforeunload', this.handleUnload.bind(this));
    
    console.log('Document editor initialized');
  }
  
  /**
   * Connect to the PartyKit server
   */
  connect() {
    try {
      // Update status
      this.updateStatus('Connecting...');
      
      // Create WebSocket connection to PartyKit
      const host = window.location.host;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${host}/party/document/${this.documentId}`;
      
      this.connection = new WebSocket(url);
      
      // Set up event handlers
      this.connection.onopen = this.handleConnectionOpen.bind(this);
      this.connection.onclose = this.handleConnectionClose.bind(this);
      this.connection.onerror = this.handleConnectionError.bind(this);
      this.connection.onmessage = this.handleMessage.bind(this);
      
      console.log('Connecting to PartyKit server...');
    } catch (error) {
      console.error('Error connecting to PartyKit server:', error);
      this.updateStatus('Connection error', false);
    }
  }
  
  /**
   * Handle WebSocket connection open
   */
  handleConnectionOpen() {
    console.log('Connected to PartyKit server');
    this.connected = true;
    this.updateStatus('Connected', true);
    
    // Send join message
    this.sendMessage({
      type: 'join',
      userId: this.userId,
      name: `User ${this.userId.substring(0, 4)}`
    });
  }
  
  /**
   * Handle WebSocket connection close
   */
  handleConnectionClose() {
    console.log('Disconnected from PartyKit server');
    this.connected = false;
    this.updateStatus('Disconnected', false);
    
    // Try to reconnect after a delay
    setTimeout(() => {
      if (!this.connected) {
        this.connect();
      }
    }, 3000);
  }
  
  /**
   * Handle WebSocket connection error
   * @param {Event} error - The error event
   */
  handleConnectionError(error) {
    console.error('WebSocket error:', error);
    this.updateStatus('Connection error', false);
  }
  
  /**
   * Handle incoming WebSocket messages
   * @param {MessageEvent} event - The message event
   */
  handleMessage(event) {
    try {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'init':
          this.handleInitMessage(message);
          break;
        case 'update':
          this.handleUpdateMessage(message);
          break;
        case 'join':
          this.handleJoinMessage(message);
          break;
        case 'leave':
          this.handleLeaveMessage(message);
          break;
        case 'presence':
          this.handlePresenceMessage(message);
          break;
        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }
  
  /**
   * Handle initialization message
   * @param {Object} message - The init message
   */
  handleInitMessage(message) {
    console.log('Received init message:', message);
    
    // Update content if it's newer than what we have
    if (message.version > this.version) {
      this.content = message.content || '';
      this.version = message.version;
      this.lastSyncedVersion = this.version;
      
      // Update editor content without triggering input event
      this.updateEditorContent(this.content);
    }
    
    // Update users list
    if (message.users) {
      this.users.clear();
      message.users.forEach(user => {
        this.users.set(user.userId, user);
      });
      this.updateUsersList();
    }
  }
  
  /**
   * Handle update message
   * @param {Object} message - The update message
   */
  handleUpdateMessage(message) {
    console.log('Received update message:', message);
    
    // Only update if the version is newer than what we have
    if (message.version > this.version) {
      this.content = message.content || '';
      this.version = message.version;
      this.lastSyncedVersion = this.version;
      
      // Update editor content without triggering input event
      this.updateEditorContent(this.content);
    }
  }
  
  /**
   * Handle join message
   * @param {Object} message - The join message
   */
  handleJoinMessage(message) {
    console.log('User joined:', message);
    
    // Add user to the list
    if (message.userId && message.userId !== this.userId) {
      this.users.set(message.userId, {
        userId: message.userId,
        name: message.name || `User ${message.userId.substring(0, 4)}`,
        status: 'active'
      });
      
      this.updateUsersList();
    }
  }
  
  /**
   * Handle leave message
   * @param {Object} message - The leave message
   */
  handleLeaveMessage(message) {
    console.log('User left:', message);
    
    // Remove user from the list
    if (message.userId && this.users.has(message.userId)) {
      this.users.delete(message.userId);
      this.updateUsersList();
    }
  }
  
  /**
   * Handle presence message
   * @param {Object} message - The presence message
   */
  handlePresenceMessage(message) {
    console.log('Presence update:', message);
    
    // Update user status
    if (message.userId && this.users.has(message.userId)) {
      const user = this.users.get(message.userId);
      user.status = message.status || 'active';
      this.users.set(message.userId, user);
      this.updateUsersList();
    }
  }
  
  /**
   * Handle editor input event
   */
  handleInput() {
    // Get current content
    const newContent = this.editorElement.value;
    
    // Update local state
    this.content = newContent;
    this.version++;
    
    // Set typing status
    this.isTyping = true;
    
    // Clear previous timeout
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    
    // Set timeout to send update after typing stops
    this.typingTimeout = setTimeout(() => {
      this.isTyping = false;
      this.sendUpdate();
    }, 500);
  }
  
  /**
   * Handle editor keydown event
   * @param {KeyboardEvent} event - The keydown event
   */
  handleKeyDown(event) {
    // Send update immediately on Enter key
    if (event.key === 'Enter') {
      if (this.typingTimeout) {
        clearTimeout(this.typingTimeout);
      }
      
      this.isTyping = false;
      this.sendUpdate();
    }
  }
  
  /**
   * Handle editor blur event
   */
  handleBlur() {
    // Send update when editor loses focus
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    
    this.isTyping = false;
    this.sendUpdate();
  }
  
  /**
   * Handle window unload event
   */
  handleUnload() {
    // Send leave message
    if (this.connected) {
      this.sendMessage({
        type: 'leave',
        userId: this.userId
      });
    }
  }
  
  /**
   * Send content update to the server
   */
  sendUpdate() {
    // Only send if content has changed since last sync
    if (this.version > this.lastSyncedVersion && this.connected) {
      this.sendMessage({
        type: 'update',
        content: this.content,
        version: this.version
      });
      
      this.lastSyncedVersion = this.version;
    }
  }
  
  /**
   * Send a message to the PartyKit server
   * @param {Object} message - The message to send
   */
  sendMessage(message) {
    if (this.connected && this.connection.readyState === WebSocket.OPEN) {
      this.connection.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send message: not connected');
    }
  }
  
  /**
   * Update the editor content without triggering input event
   * @param {string} content - The content to set
   */
  updateEditorContent(content) {
    // Remove input event listener temporarily
    this.editorElement.removeEventListener('input', this.handleInput);
    
    // Update content
    this.editorElement.value = content;
    
    // Re-add input event listener
    this.editorElement.addEventListener('input', this.handleInput.bind(this));
  }
  
  /**
   * Update the connection status display
   * @param {string} status - The status text
   * @param {boolean} isConnected - Whether the connection is active
   */
  updateStatus(status, isConnected) {
    if (this.statusElement) {
      this.statusElement.textContent = status;
    }
    
    if (this.statusIndicator) {
      this.statusIndicator.className = 'status-indicator';
      this.statusIndicator.classList.add(isConnected ? 'status-connected' : 'status-disconnected');
    }
  }
  
  /**
   * Update the users list display
   */
  updateUsersList() {
    if (!this.usersElement) return;
    
    // Clear current list
    this.usersElement.innerHTML = '';
    
    if (this.users.size === 0) {
      this.usersElement.innerHTML = '<div>No other users connected</div>';
      return;
    }
    
    // Create list
    const ul = document.createElement('ul');
    
    // Add each user
    this.users.forEach(user => {
      if (user.userId !== this.userId) {
        const li = document.createElement('li');
        li.className = `status-${user.status || 'active'}`;
        li.textContent = user.name || `User ${user.userId.substring(0, 4)}`;
        ul.appendChild(li);
      }
    });
    
    // Add current user
    const currentUser = document.createElement('li');
    currentUser.className = 'status-active';
    currentUser.textContent = `You (User ${this.userId.substring(0, 4)})`;
    ul.appendChild(currentUser);
    
    // Add to DOM
    this.usersElement.appendChild(ul);
  }
  
  /**
   * Generate a random user ID
   * @returns {string} A random user ID
   */
  generateUserId() {
    return Math.random().toString(36).substring(2, 10);
  }
  
  /**
   * Get the current content
   * @returns {string} The current content
   */
  getContent() {
    return this.content;
  }
  
  /**
   * Set the content
   * @param {string} content - The content to set
   */
  setContent(content) {
    this.content = content;
    this.version++;
    this.updateEditorContent(content);
    this.sendUpdate();
  }
}

// Initialize the document editor when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // Create and expose the document editor instance
  window.documentEditor = new DocumentEditor();
}); 