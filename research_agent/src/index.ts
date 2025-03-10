/**
 * Competitive Research Agent - Main Worker
 * 
 * This is the entry point for the Research Agent. It handles:
 * - URL submission via POST /scrape
 * - Task status checking via GET /task/:id
 * - Report retrieval via GET /report/:id
 */

// Import necessary types from Cloudflare Workers
import { 
  DurableObjectNamespace, 
  DurableObjectState, 
  R2Bucket, 
  ExecutionContext,
  KVNamespace
} from '@cloudflare/workers-types';

// Define the environment interface with our bindings
export interface Env {
  // Durable Object namespace for managing research tasks
  RESEARCH_TASK_DO: DurableObjectNamespace;
  // R2 bucket for storing reports
  RESEARCH_REPORTS: R2Bucket;
  // AI Gateway for report generation
  AI_GATEWAY: any;
  // Static assets
  __STATIC_CONTENT: KVNamespace;
}

// Helper function to generate a response with CORS headers
function corsResponse(body: any, status = 200) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json'
  };
  
  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}

// Main fetch handler for the Worker
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
          'Access-Control-Max-Age': '86400'
        }
      });
    }
    
    // Handle URL submission (Phase 1)
    if (path === '/scrape' && request.method === 'POST') {
      try {
        // Parse the request body to get the target URL
        let targetUrl: string;
        try {
          const body = await request.json() as { targetUrl?: string };
          targetUrl = body.targetUrl || '';
          console.log('Received request with targetUrl:', targetUrl);
        } catch (parseError) {
          console.error('Error parsing request body:', parseError);
          return corsResponse({ error: 'Invalid JSON in request body' }, 400);
        }
        
        // Validate the URL
        if (!targetUrl || typeof targetUrl !== 'string') {
          console.error('Invalid or missing targetUrl parameter');
          return corsResponse({ error: 'Invalid or missing targetUrl parameter' }, 400);
        }
        
        try {
          // Validate that the URL is properly formatted
          new URL(targetUrl);
        } catch (e) {
          console.error('Invalid URL format:', e);
          return corsResponse({ error: 'Invalid URL format' }, 400);
        }
        
        // Generate a unique ID for this task
        const taskId = crypto.randomUUID();
        console.log('Generated taskId:', taskId);
        
        try {
          // Create a Durable Object ID using newUniqueId() instead of idFromString()
          const doId = env.RESEARCH_TASK_DO.newUniqueId();
          console.log('Created Durable Object ID:', doId.toString());
          
          // Get a stub for the Durable Object
          const doStub = env.RESEARCH_TASK_DO.get(doId);
          console.log('Got Durable Object stub');
          
          // Initialize the task in the Durable Object
          console.log('Sending request to Durable Object');
          const doResponse = await doStub.fetch("https://fake-host/init", {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ targetUrl, taskId })
          });
          
          console.log('Received response from Durable Object:', await doResponse.text());
          
          // Return the task ID to the client
          return corsResponse({
            status: 'queued',
            jobId: taskId
          });
        } catch (doError: unknown) {
          console.error('Error with Durable Object operations:', doError);
          const errorMessage = doError instanceof Error ? doError.message : String(doError);
          return corsResponse({ error: 'Error processing task', details: errorMessage }, 500);
        }
      } catch (error) {
        console.error('Error processing scrape request:', error);
        return corsResponse({ 
          error: 'Internal server error', 
          message: error instanceof Error ? error.message : String(error)
        }, 500);
      }
    }
    
    // Handle task status checking (will be implemented in Phase 2)
    if (path.startsWith('/task/') && request.method === 'GET') {
      const taskId = path.split('/task/')[1];
      
      if (!taskId) {
        return corsResponse({ error: 'Missing task ID' }, 400);
      }
      
      try {
        // Get a stub for the Durable Object
        const doId = env.RESEARCH_TASK_DO.idFromString(taskId);
        const doStub = env.RESEARCH_TASK_DO.get(doId);
        
        // Get the task status from the Durable Object
        const response = await doStub.fetch('http://do/status');
        const result = await response.json();
        
        return corsResponse(result);
      } catch (error) {
        console.error('Error checking task status:', error);
        return corsResponse({ error: 'Internal server error' }, 500);
      }
    }
    
    // Handle report retrieval (will be implemented in Phase 4)
    if (path.startsWith('/report/') && request.method === 'GET') {
      const taskId = path.split('/report/')[1];
      
      if (!taskId) {
        return corsResponse({ error: 'Missing task ID' }, 400);
      }
      
      try {
        // Check if the report exists in R2
        const reportObject = await env.RESEARCH_REPORTS.get(`${taskId}.json`);
        
        if (!reportObject) {
          return corsResponse({ error: 'Report not found' }, 404);
        }
        
        // For Phase 1, we'll just return a message that the report exists
        // In Phase 4, we'll implement proper R2 integration with S3 compatibility API for presigned URLs
        return corsResponse({
          status: 'completed',
          message: 'Report found. Presigned URL generation will be implemented in Phase 4.',
          reportId: taskId,
          reportSize: reportObject.size,
          reportEtag: reportObject.etag
        });
      } catch (error) {
        console.error('Error retrieving report:', error);
        return corsResponse({ error: 'Internal server error' }, 500);
      }
    }
    
    // Serve static assets (index.html) for the root path
    if (path === '/' || path === '/index.html') {
      try {
        // Try to get the static asset from the __STATIC_CONTENT namespace
        let asset = null;
        
        if (env.__STATIC_CONTENT) {
          asset = await env.__STATIC_CONTENT.get('index.html');
        }
        
        // If the asset is not found or __STATIC_CONTENT is not available,
        // return a simple HTML response for local development
        if (asset === null) {
          return new Response(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Research Agent API</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  max-width: 800px;
                  margin: 0 auto;
                  padding: 20px;
                  line-height: 1.6;
                }
                h1 { color: #333; }
                .endpoint {
                  background: #f5f5f5;
                  padding: 15px;
                  border-radius: 5px;
                  margin-bottom: 15px;
                }
                code {
                  background: #e0e0e0;
                  padding: 2px 5px;
                  border-radius: 3px;
                }
              </style>
            </head>
            <body>
              <h1>Research Agent API</h1>
              <p>Welcome to the Research Agent API. Use the following endpoints:</p>
              
              <div class="endpoint">
                <h2>Submit URL for Scraping</h2>
                <p><code>POST /scrape</code></p>
                <p>Request body: <code>{ "targetUrl": "https://example.com" }</code></p>
              </div>
              
              <div class="endpoint">
                <h2>Check Task Status</h2>
                <p><code>GET /task/:id</code></p>
              </div>
              
              <div class="endpoint">
                <h2>Get Report</h2>
                <p><code>GET /report/:id</code></p>
              </div>
              
              <p>For more information, refer to the documentation.</p>
            </body>
            </html>
          `, {
            headers: {
              'Content-Type': 'text/html',
              'Cache-Control': 'no-cache'
            }
          });
        }
        
        return new Response(asset, {
          headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'public, max-age=3600',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (error) {
        console.error('Error serving static asset:', error);
        return new Response('Internal server error', { status: 500 });
      }
    }
    
    // Handle unknown routes
    return corsResponse({ error: 'Not found' }, 404);
  }
};

// Export the Durable Object class (will be implemented in Phase 2)
export class ResearchTaskDO {
  state: DurableObjectState;
  env: Env;
  
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }
  
  // Handle fetch requests to the Durable Object
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    console.log('Durable Object received request to path:', path);
    
    // Initialize a new task
    if (path === '/init' && request.method === 'POST') {
      try {
        const body = await request.json() as { targetUrl?: string, taskId?: string };
        const targetUrl = body.targetUrl;
        const taskId = body.taskId;
        
        console.log('Initializing task with ID:', taskId, 'and URL:', targetUrl);
        
        if (!targetUrl || !taskId) {
          console.error('Missing targetUrl or taskId in request body');
          return new Response(JSON.stringify({ error: 'Missing targetUrl or taskId' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        // Store the task information
        await this.state.storage.put('targetUrl', targetUrl);
        await this.state.storage.put('taskId', taskId);
        await this.state.storage.put('status', 'queued');
        await this.state.storage.put('createdAt', new Date().toISOString());
        
        console.log('Task initialized successfully');
        
        return new Response(JSON.stringify({ status: 'queued' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error initializing task:', error);
        return new Response(JSON.stringify({ 
          error: 'Error initializing task',
          message: error instanceof Error ? error.message : String(error)
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Get the task status
    if (path === '/status' && request.method === 'GET') {
      try {
        const status = await this.state.storage.get('status') || 'unknown';
        const targetUrl = await this.state.storage.get('targetUrl');
        const taskId = await this.state.storage.get('taskId');
        const createdAt = await this.state.storage.get('createdAt');
        
        return new Response(JSON.stringify({
          status,
          targetUrl,
          taskId,
          createdAt
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error getting task status:', error);
        return new Response(JSON.stringify({ 
          error: 'Error getting task status',
          message: error instanceof Error ? error.message : String(error)
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Handle unknown routes
    console.error('Unknown route requested:', path);
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
} 