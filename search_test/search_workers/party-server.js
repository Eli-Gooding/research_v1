/**
 * PartyKit Server for Search Agent
 * 
 * This server is responsible for:
 * 1. Managing research jobs and their state
 * 2. Coordinating parallel research tasks
 * 3. Triggering compilation when all research tasks are complete
 */

// Define initial state
const initialState = {
  jobs: {},
  activeJobs: 0
};

export class SearchAgentServer {
  // In-memory state for development
  memoryState = { ...initialState };

  constructor(party) {
    this.party = party;
  }

  // Initialize storage when the party starts
  async onStart() {
    console.log('Initializing PartyKit server');
    try {
      // Initialize storage with empty state
      await this.party.storage.put("state", this.memoryState);
      console.log('Storage initialized successfully');
    } catch (error) {
      console.error('Error initializing storage:', error);
    }
  }

  // This is called when a client connects to the server
  async onConnect(connection) {
    console.log('Client connecting to PartyKit server');
    
    try {
      // Store the connection in the room's storage for later use
      const connections = await this.party.storage.get("connections") || [];
      connections.push(connection.id);
      await this.party.storage.put("connections", connections);
      console.log(`Stored connection ${connection.id} in room storage`);
      
      // Calculate progress for active jobs
      const state = { ...this.memoryState };
      
      // Add progress information for each job
      if (state.jobs) {
        Object.keys(state.jobs).forEach(jobId => {
          const job = state.jobs[jobId];
          if (job.categories) {
            const categories = Object.keys(job.categories);
            const completedCategories = categories.filter(
              category => job.categories[category] === 'completed'
            );
            
            job.progress = {
              total: categories.length,
              completed: completedCategories.length
            };
          }
        });
      }
      
      // Send current state to the client
      try {
        connection.send(JSON.stringify({
          type: 'state',
          state: state
        }));
        console.log('Sent initial state to client');
      } catch (error) {
        console.error('Error sending initial state to client:', error);
      }
    } catch (error) {
      console.error('Error in onConnect:', error);
    }
  }
  
  // This is called when a client sends a message to the server
  async onMessage(message, connection) {
    console.log('Received message:', message);
    
    try {
      // Parse the message
      let data;
      try {
        data = JSON.parse(message);
      } catch (error) {
        console.error('Error parsing message:', error);
        return;
      }
      
      // Handle PartyKit system messages (like join)
      if (data.type === 'join') {
        console.log(`User ${data.userId} joined`);
        
        // Send current state to the client
        try {
          // Calculate progress for active jobs
          const state = { ...this.memoryState };
          
          // Add progress information for each job
          if (state.jobs) {
            Object.keys(state.jobs).forEach(jobId => {
              const job = state.jobs[jobId];
              if (job.categories) {
                const categories = Object.keys(job.categories);
                const completedCategories = categories.filter(
                  category => job.categories[category] === 'completed'
                );
                
                job.progress = {
                  total: categories.length,
                  completed: completedCategories.length
                };
              }
            });
          }
          
          // Send current state to the client
          connection.send(JSON.stringify({
            type: 'state',
            state: state
          }));
          console.log('Sent state after join');
        } catch (error) {
          console.error('Error sending state after join:', error);
        }
        
        return;
      }
      
      // Check if data and action exist
      if (!data || !data.action) {
        console.warn('Message missing action field:', data);
        return;
      }
      
      // Log the context for debugging
      console.log('Message context:', {
        hasConnection: !!connection,
        action: data.action
      });
      
      switch (data.action) {
        case 'startResearch':
          await this.handleStartResearch(data, connection);
          break;
        
        case 'researchCategory':
          await this.handleResearchCategory(data, connection);
          break;
        
        case 'compile':
          await this.handleCompile(data, connection);
          break;
        
        case 'getStatus':
          await this.handleGetStatus(data, connection);
          break;
          
        default:
          console.warn(`Unknown action: ${data.action}`);
          
          // Try to send an error response if connection is available
          if (connection) {
            try {
              connection.send(JSON.stringify({
                type: 'error',
                error: `Unknown action: ${data.action}`
              }));
            } catch (error) {
              console.error('Error sending error response:', error);
            }
          }
      }
    } catch (error) {
      console.error('Error processing message:', error);
      
      // Try to send an error response if connection is available
      if (connection) {
        try {
          connection.send(JSON.stringify({
            type: 'error',
            error: 'Error processing message: ' + error.message
          }));
        } catch (sendError) {
          console.error('Error sending error response:', sendError);
        }
      }
    }
  }
  
  // Handle HTTP requests to the PartyKit server
  async onRequest(req) {
    console.log(`HTTP ${req.method} request to ${req.url}`);
    
    // Set CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
    
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }
    
    // Only accept POST requests
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Method not allowed'
        }),
        {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    }
    
    try {
      // Parse the request body
      const data = await req.json();
      
      // Handle different actions
      if (data.action === 'startResearch') {
        // Process the startResearch action
        const { jobId, companyName, officialWebsite, categories, query } = data;
        
        // Update memory state
        this.memoryState.jobs[jobId] = {
          status: 'processing',
          companyName,
          officialWebsite,
          query,
          categories: {},
          createdAt: new Date().toISOString()
        };
        
        this.memoryState.activeJobs += 1;
        
        // Initialize category status
        if (categories && categories.length > 0) {
          for (const category of categories) {
            this.memoryState.jobs[jobId].categories[category] = 'pending';
          }
        }
        
        // Broadcast to all clients
        try {
          this.party.broadcast(JSON.stringify({
            type: 'jobStarted',
            jobId,
            companyName
          }));
          console.log('Broadcasted job start to all clients via HTTP request');
        } catch (error) {
          console.error('Error broadcasting job start via HTTP request:', error);
        }
        
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Research job started',
            jobId
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          }
        );
      } else if (data.action === 'researchCategory') {
        // Process the researchCategory action
        const { jobId, category, status, categoryKey } = data;
        
        if (this.memoryState.jobs[jobId]) {
          this.memoryState.jobs[jobId].categories[category] = status;
          
          // Broadcast to all clients
          try {
            this.party.broadcast(JSON.stringify({
              type: 'categoryCompleted',
              jobId,
              category,
              categoryKey,
              status
            }));
            console.log('Broadcasted category completion to all clients');
          } catch (error) {
            console.error('Error broadcasting category completion:', error);
          }
        }
        
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Category status updated'
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          }
        );
      } else if (data.action === 'compile') {
        // Process the compile action
        const { jobId } = data;
        
        if (this.memoryState.jobs[jobId]) {
          this.memoryState.jobs[jobId].status = 'compiling';
          
          // Broadcast to all clients
          try {
            this.party.broadcast(JSON.stringify({
              type: 'compilationStarted',
              jobId
            }));
            console.log('Broadcasted compilation start to all clients');
          } catch (error) {
            console.error('Error broadcasting compilation start:', error);
          }
        }
        
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Compilation started'
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          }
        );
      }
      
      // Unknown action
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Unknown action'
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    } catch (error) {
      console.error('Error processing HTTP request:', error);
      
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message || 'An unexpected error occurred'
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    }
  }

  /**
   * Start the research process by launching parallel research tasks
   * @param {Object} data - The message data
   * @param {Object} connection - The client connection
   */
  async handleStartResearch(data, connection) {
    const { jobId, companyName, officialWebsite, categories, query } = data;
    
    console.log(`Starting research for job ${jobId}:`, {
      companyName,
      categories: categories?.length || 0
    });
    
    // Update memory state
    this.memoryState.jobs[jobId] = {
      status: 'processing',
      companyName,
      officialWebsite,
      query,
      categories: {},
      createdAt: new Date().toISOString()
    };
    
    this.memoryState.activeJobs += 1;
    
    // Send job start notification if connection is available
    if (connection) {
      try {
        connection.send(JSON.stringify({
          type: 'jobStarted',
          jobId,
          companyName
        }));
      } catch (error) {
        console.error('Error sending job start notification:', error);
      }
    }
    
    // Broadcast to all clients
    try {
      this.party.broadcast(JSON.stringify({
        type: 'jobStarted',
        jobId,
        companyName
      }));
      console.log('Broadcasted job start to all clients');
    } catch (error) {
      console.error('Error broadcasting job start:', error);
    }
    
    // Launch parallel research tasks
    if (!categories || categories.length === 0) {
      console.error('No categories specified for research');
      return;
    }
    
    // Always use a fully qualified URL for localhost to ensure it works in the PartyKit environment
    const researchWorkerUrl = this.party.env?.RESEARCH_WORKER_URL || 'http://localhost:8787/research';
    console.log(`Using research worker URL: ${researchWorkerUrl}`);
    
    try {
      // Create an array of promises for each category request
      const researchPromises = categories.map(async (category) => {
        // Initialize category status
        this.memoryState.jobs[jobId].categories[category] = 'pending';
        
        // Make a request to the research worker
        const categoryKey = category.replace(/ /g, '_').toLowerCase();
        
        console.log(`Dispatching research for category: ${category} to ${researchWorkerUrl}`);
        
        // Create a JSON-stringified request body
        const requestBody = JSON.stringify({
          jobId,
          companyName,
          category,
          categoryKey,
          website: officialWebsite
        });
        
        console.log(`Request body for ${category}: ${requestBody}`);
        
        try {
          console.log(`DEBUG: Starting fetch for category ${category}`);
          
          const response = await fetch(researchWorkerUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: requestBody
          });
          
          console.log(`DEBUG: Fetch succeeded for ${category} with status: ${response.status}`);
          
          const text = await response.text();
          console.log(`DEBUG: Received response text for ${category}: ${text}`);
          
          try {
            const responseData = JSON.parse(text);
            
            // If the research was successful, update the category status
            if (responseData.success) {
              // Update category status based on the response
              this.memoryState.jobs[jobId].categories[category] = responseData.status || 'processing';
              
              console.log(`Updated category status for ${category} to ${responseData.status || 'processing'}`);
            } else {
              // If there was an error, update the category status
              this.memoryState.jobs[jobId].categories[category] = 'error';
              console.error(`Error from research worker for ${category}: ${responseData.error || 'Unknown error'}`);
            }
          } catch (parseError) {
            console.error(`Error parsing research worker response for ${category}: ${parseError.message}`);
            console.log(`Raw response: ${text}`);
            this.memoryState.jobs[jobId].categories[category] = 'error';
          }
        } catch (err) {
          console.error(`DEBUG: Fetch error for ${category}:`, err);
          console.error(`Error message: ${err.message}`);
          
          // Update category status on error
          if (this.memoryState.jobs[jobId]) {
            this.memoryState.jobs[jobId].categories[category] = 'error';
          }
        }
        
        // Send category start notification if connection is available
        if (connection) {
          try {
            connection.send(JSON.stringify({
              type: 'categoryStarted',
              jobId,
              category,
              categoryKey
            }));
          } catch (error) {
            console.error('Error sending category start notification:', error);
          }
        }
      });
      
      // Run all research promises in parallel and wait for them to complete
      // We use Promise.allSettled to ensure we continue even if some promises reject
      console.log(`Starting ${researchPromises.length} parallel research tasks`);
      
      // Process the promises without blocking the main function
      Promise.allSettled(researchPromises).then(results => {
        console.log(`Completed all ${results.length} research tasks`);
        
        // Count successful and failed tasks
        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        
        console.log(`Research tasks completed: ${succeeded} succeeded, ${failed} failed`);
        
        // Check if we need to automatically trigger compilation
        this.checkAndTriggerCompilation(jobId, connection);
      }).catch(err => {
        console.error('Error in Promise.allSettled:', err);
      });
      
    } catch (error) {
      console.error('Error launching research tasks:', error);
    }
  }
  
  /**
   * Check if all categories are complete and trigger compilation if needed
   * @param {string} jobId - The job ID to check
   * @param {Object} connection - The client connection
   */
  async checkAndTriggerCompilation(jobId, connection) {
    // Check if all categories are complete
    const job = this.memoryState.jobs[jobId];
    if (!job) {
      console.warn(`Job ${jobId} not found in state when checking for completion`);
      return;
    }
    
    const allComplete = Object.values(job.categories).every(
      s => s === 'completed' || s === 'error'
    );
    
    if (allComplete) {
      console.log(`All categories completed for job ${jobId}, triggering compilation`);
      
      // Trigger compilation
      await this.handleCompile({ jobId }, connection);
    } else {
      console.log(`Not all categories are complete for job ${jobId}, waiting for completion`);
    }
  }

  /**
   * Handle research category completion
   * @param {Object} data - The message data
   * @param {Object} connection - The client connection
   */
  async handleResearchCategory(data, connection) {
    const { jobId, category, status, categoryKey } = data;
    
    console.log(`Category completed for job ${jobId}:`, {
      category,
      status
    });
    
    // Update memory state
    if (!this.memoryState.jobs[jobId]) {
      console.warn(`Job ${jobId} not found in state`);
      return;
    }
    
    this.memoryState.jobs[jobId].categories[category] = status;
    
    // Send category completion notification if connection is available
    if (connection) {
      try {
        connection.send(JSON.stringify({
          type: 'categoryCompleted',
          jobId,
          category,
          categoryKey,
          status
        }));
      } catch (error) {
        console.error('Error sending category completion notification:', error);
      }
    }
    
    // Check if all categories are complete
    const job = this.memoryState.jobs[jobId];
    const allComplete = Object.values(job.categories).every(
      s => s === 'completed' || s === 'error'
    );
    
    if (allComplete) {
      console.log(`All categories completed for job ${jobId}, triggering compilation`);
      
      // Trigger compilation
      await this.handleCompile({ jobId }, connection);
    }
  }

  /**
   * Handle compilation request
   * @param {Object} data - The message data
   * @param {Object} connection - The client connection
   */
  async handleCompile(data, connection) {
    const { jobId } = data;
    
    console.log(`Starting compilation for job ${jobId}`);
    
    // Update memory state
    if (!this.memoryState.jobs[jobId]) {
      console.warn(`Job ${jobId} not found in state`);
      return;
    }
    
    this.memoryState.jobs[jobId].status = 'compiling';
    
    // Send compilation start notification if connection is available
    if (connection) {
      try {
        connection.send(JSON.stringify({
          type: 'compilationStarted',
          jobId
        }));
      } catch (error) {
        console.error('Error sending compilation start notification:', error);
      }
    }
    
    try {
      const compilationWorkerUrl = this.party.env?.COMPILATION_WORKER_URL || 'http://localhost:8787/compilation';
      console.log(`Using compilation worker URL: ${compilationWorkerUrl}`);
      
      // Make a request to the compilation worker using standard fetch API
      const requestBody = JSON.stringify({ jobId });
      console.log(`Making fetch request to compilation worker with body: ${requestBody}`);
      
      // Use the standard fetch API
      const response = await fetch(compilationWorkerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: requestBody
      });
      
      console.log(`Compilation worker responded with status: ${response.status}`);
      const responseText = await response.text();
      console.log(`Compilation worker response: ${responseText}`);
      
      const result = JSON.parse(responseText);
      
      console.log(`Compilation result for job ${jobId}:`, {
        status: result.status,
        success: result.success
      });
      
      // Update job status
      this.memoryState.jobs[jobId].status = result.status;
      this.memoryState.jobs[jobId].completedAt = result.completedAt;
      
      if (result.status === 'completed') {
        this.memoryState.activeJobs -= 1;
      }
      
      // Send compilation completion notification if connection is available
      if (connection) {
        try {
          connection.send(JSON.stringify({
            type: 'compilationCompleted',
            jobId,
            status: result.status,
            success: result.success
          }));
        } catch (error) {
          console.error('Error sending compilation completion notification:', error);
        }
      }
    } catch (error) {
      console.error(`Error compiling job ${jobId}:`, error);
      
      // Update job status on error
      this.memoryState.jobs[jobId].status = 'error';
      this.memoryState.jobs[jobId].error = error.message;
      
      // Send compilation error notification if connection is available
      if (connection) {
        try {
          connection.send(JSON.stringify({
            type: 'compilationError',
            jobId,
            error: error.message
          }));
        } catch (sendError) {
          console.error('Error sending compilation error notification:', sendError);
        }
      }
    }
  }

  /**
   * Handle status request
   * @param {Object} data - The message data
   * @param {Object} connection - The client connection
   */
  async handleGetStatus(data, connection) {
    const { jobId } = data;
    
    // If connection is undefined, we can't send a response
    if (!connection) {
      console.warn('Connection is undefined in handleGetStatus, cannot send response');
      return;
    }
    
    try {
      if (jobId) {
        // Get status for a specific job
        const job = this.memoryState.jobs[jobId];
        
        if (!job) {
          connection.send(JSON.stringify({
            type: 'jobStatus',
            jobId,
            status: 'notFound'
          }));
          return;
        }
        
        // Calculate progress
        const categories = job.categories ? Object.keys(job.categories) : [];
        const completedCategories = categories.filter(
          category => job.categories[category] === 'completed'
        );
        
        const progress = {
          total: categories.length,
          completed: completedCategories.length
        };
        
        connection.send(JSON.stringify({
          type: 'jobStatus',
          action: 'status', // Add action field for consistency
          jobId,
          status: job.status || 'pending',
          categories: job.categories || {},
          progress,
          ...job
        }));
      } else {
        // Get overall status
        connection.send(JSON.stringify({
          type: 'status',
          action: 'status', // Add action field for consistency
          activeJobs: this.memoryState.activeJobs,
          jobCount: Object.keys(this.memoryState.jobs).length
        }));
      }
    } catch (error) {
      console.error('Error sending job status notification:', error);
      
      // Try to send an error response
      try {
        connection.send(JSON.stringify({
          type: 'error',
          error: error.message || 'Failed to get job status'
        }));
      } catch (sendError) {
        console.error('Failed to send error notification:', sendError);
      }
    }
  }
}

export default SearchAgentServer; 