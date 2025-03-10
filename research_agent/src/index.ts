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

// Import AWS SDK for S3 presigned URLs
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Define the environment interface with our bindings
export interface Env {
  // Durable Object namespace for managing research tasks
  RESEARCH_TASK_DO: DurableObjectNamespace;
  // R2 bucket for storing reports
  RESEARCH_REPORTS: R2Bucket;
  // AI Gateway for report generation
  AI_GATEWAY: any;
  // OpenAI API Key for report generation
  OPENAI_API_KEY: string;
  // OpenAI model configuration
  OPENAI_MODEL: string;
  // Model pricing per 1K tokens (in USD)
  OPENAI_PROMPT_PRICE: string;
  OPENAI_COMPLETION_PRICE: string;
  // Static assets
  __STATIC_CONTENT: KVNamespace;
  // Worker URL for detailed analysis
  WORKER_URL?: string;
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
    // Start timing for performance tracking
    const requestStartTime = Date.now();
    
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return corsResponse({}, 204);
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    console.log('Request received:', request.method, path);
    
    try {
      // Serve static assets
      if (request.method === 'GET' && !path.startsWith('/api/')) {
        // For static content, return a simple response or try to serve from KV
        try {
          // If path is root, serve index.html
          const assetPath = path === '/' ? 'index.html' : path.replace(/^\//, '');
          console.log(`Serving static asset: ${assetPath}`);
          
          // Get the asset from the __STATIC_CONTENT namespace
          const asset = await env.__STATIC_CONTENT.get(assetPath);
          
          if (asset === null) {
            console.log(`Static asset not found: ${assetPath}`);
            // Continue to API routes
          } else {
            // Determine content type based on file extension
            let contentType = 'text/plain';
            if (assetPath.endsWith('.html')) contentType = 'text/html';
            else if (assetPath.endsWith('.css')) contentType = 'text/css';
            else if (assetPath.endsWith('.js')) contentType = 'application/javascript';
            else if (assetPath.endsWith('.json')) contentType = 'application/json';
            else if (assetPath.endsWith('.png')) contentType = 'image/png';
            else if (assetPath.endsWith('.jpg') || assetPath.endsWith('.jpeg')) contentType = 'image/jpeg';
            else if (assetPath.endsWith('.svg')) contentType = 'image/svg+xml';
            
            return new Response(asset, {
              headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=3600'
              }
            });
          }
        } catch (error) {
          console.error('Error serving static asset:', error);
          // Continue to API routes
        }
      }
      
      // API endpoints
      if (path === '/scrape' && request.method === 'POST') {
        const scrapeStartTime = Date.now();
        
        try {
          const body = await request.json() as { targetUrl?: string };
          const targetUrl = body.targetUrl;
          
          if (!targetUrl) {
            return corsResponse({ error: 'Missing targetUrl in request body' }, 400);
          }
          
          // Validate URL
          try {
            new URL(targetUrl);
          } catch (e) {
            return corsResponse({ error: 'Invalid URL format' }, 400);
          }
          
          // Generate a unique task ID
          const taskId = crypto.randomUUID();
          
          // Get a stub for the Durable Object
          const id = env.RESEARCH_TASK_DO.newUniqueId();
          const stub = env.RESEARCH_TASK_DO.get(id);
          
          // Initialize the task in the Durable Object
          await stub.fetch('https://dummy-url/init', {
            method: 'POST',
            body: JSON.stringify({
              targetUrl,
              taskId
            })
          });
          
          const scrapeEndTime = Date.now();
          console.log(`Scrape request processed in ${scrapeEndTime - scrapeStartTime}ms`);
          
          return corsResponse({
            status: 'queued',
            jobId: taskId,
            message: 'URL submitted for scraping'
          });
        } catch (error) {
          console.error('Error processing scrape request:', error);
          return corsResponse({ error: 'Failed to process request' }, 500);
        }
      }
      
      // Get configuration endpoint
      if (path === '/config' && request.method === 'GET') {
        const configStartTime = Date.now();
        
        // Return the current configuration
        const config = {
          model: env.OPENAI_MODEL || 'gpt-4',
          promptPrice: env.OPENAI_PROMPT_PRICE || '0.03',
          completionPrice: env.OPENAI_COMPLETION_PRICE || '0.06'
        };
        
        const configEndTime = Date.now();
        console.log(`Config request processed in ${configEndTime - configStartTime}ms`);
        
        return corsResponse({
          status: 'success',
          config
        });
      }
      
      // Update configuration endpoint (for testing only, not for production)
      if (path === '/config' && request.method === 'POST') {
        const configStartTime = Date.now();
        
        try {
          const body = await request.json() as { 
            model?: string;
            promptPrice?: string;
            completionPrice?: string;
          };
          
          console.log('Updating configuration:', body);
          
          // Store the configuration
          if (body.model) {
            await this.state.storage.put('config_model', body.model);
          }
          
          if (body.promptPrice) {
            await this.state.storage.put('config_promptPrice', body.promptPrice);
          }
          
          if (body.completionPrice) {
            await this.state.storage.put('config_completionPrice', body.completionPrice);
          }
          
          // Return the updated configuration
          const config = {
            model: (await this.state.storage.get('config_model') as string) || this.env.OPENAI_MODEL || 'gpt-4',
            promptPrice: (await this.state.storage.get('config_promptPrice') as string) || this.env.OPENAI_PROMPT_PRICE || '0.03',
            completionPrice: (await this.state.storage.get('config_completionPrice') as string) || this.env.OPENAI_COMPLETION_PRICE || '0.06'
          };
          
          const configEndTime = Date.now();
          console.log(`Config update processed in ${configEndTime - configStartTime}ms`);
          
          return corsResponse({
            status: 'success',
            message: 'Configuration updated',
            config: config
          });
        } catch (error) {
          console.error('Error updating configuration:', error);
          return corsResponse({ error: 'Failed to update configuration' }, 500);
        }
      }
      
      // Check if the R2 bucket is accessible
      try {
        // Try to list objects in the bucket to verify access
        const objects = await env.RESEARCH_REPORTS.list({ limit: 1 });
        console.log('R2 bucket is accessible, found', objects.objects.length, 'objects');
      } catch (error) {
        console.error('Error accessing R2 bucket:', error);
        // We'll continue even if there's an error, as the bucket might just be empty
      }
      
      // Handle task status checking (Phase 2)
      if (path.startsWith('/task/') && request.method === 'GET') {
        const taskId = path.split('/task/')[1];
        
        if (!taskId) {
          return corsResponse({ error: 'Missing task ID' }, 400);
        }
        
        try {
          // Get a stub for the Durable Object using idFromName with the taskId
          const doId = env.RESEARCH_TASK_DO.idFromName(taskId);
          const doStub = env.RESEARCH_TASK_DO.get(doId);
          
          // Get the task status from the Durable Object
          const response = await doStub.fetch('http://do/status');
          
          // Parse the response as text first to handle any JSON parsing errors
          const responseText = await response.text();
          let result;
          
          try {
            result = JSON.parse(responseText);
          } catch (parseError) {
            console.error('Error parsing task status response:', parseError, 'Response text:', responseText);
            return corsResponse({ 
              error: 'Error parsing task status response',
              responseText: responseText.substring(0, 100) // Include part of the response for debugging
            }, 500);
          }
          
          return corsResponse(result);
        } catch (error) {
          console.error('Error checking task status:', error);
          return corsResponse({ error: 'Internal server error' }, 500);
        }
      }
      
      // Handle report retrieval (Phase 4)
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
          
          // Generate a presigned URL for the report
          // Get the R2 bucket information from the request URL
          const accountId = url.hostname.split('.')[0];
          const bucketName = 'research-reports';
          
          // Configure the S3 client to use Cloudflare R2
          // PRODUCTION NOTE: In production, you'll need to ensure your Cloudflare account ID is correctly
          // extracted or configured. The Worker's credentials are automatically used by R2.
          const s3Client = new S3Client({
            region: 'auto',
            endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
            credentials: {
              // These are placeholder values - R2 uses the Worker's credentials automatically
              accessKeyId: 'placeholder',
              secretAccessKey: 'placeholder'
            }
          });
          
          // Create a GetObject command for the report
          const command = new GetObjectCommand({
            Bucket: bucketName,
            Key: `${taskId}.json`
          });
          
          // Generate a presigned URL that expires in 1 hour (3600 seconds)
          // PRODUCTION NOTE: In production, you may want to adjust the expiration time
          // based on your security requirements
          const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
          
          // For local development, we'll serve the report directly instead of using presigned URLs
          // This helps avoid CORS and SSL issues in development
          let reportData;
          let reportUrl: string | null = presignedUrl;
          
          // Check if we're in a local development environment
          // PRODUCTION NOTE: This automatically detects the environment and adapts the behavior
          const isLocalDev = url.hostname.includes('localhost') || url.hostname.includes('127.0.0.1');
          
          if (isLocalDev) {
            // For local development, read the report and return it directly
            try {
              const reportText = await reportObject.text();
              reportData = JSON.parse(reportText);
            } catch (parseError) {
              console.error('Error parsing report:', parseError);
              return corsResponse({ 
                error: 'Error parsing report',
                details: parseError instanceof Error ? parseError.message : String(parseError)
              }, 500);
            }
            reportUrl = null; // We won't use the presigned URL in local dev
          }
          
          return corsResponse({
            status: 'completed',
            reportId: taskId,
            reportUrl: reportUrl,
            reportSize: reportObject.size,
            reportEtag: reportObject.etag,
            expiresIn: '1 hour',
            // Include the report data directly in local development
            ...(isLocalDev && { reportData })
          });
        } catch (error) {
          console.error('Error retrieving report:', error);
          return corsResponse({ error: 'Internal server error' }, 500);
        }
      }
      
      // Handle listing all reports (Phase 4)
      if (path === '/reports' && request.method === 'GET') {
        try {
          // List all objects in the R2 bucket
          const objects = await env.RESEARCH_REPORTS.list();
          
          // Map the objects to a more user-friendly format
          const reports = objects.objects.map(obj => {
            return {
              reportId: obj.key.replace('.json', ''),
              size: obj.size,
              etag: obj.etag,
              uploaded: obj.uploaded
            };
          });
          
          return corsResponse({
            status: 'success',
            count: reports.length,
            reports
          });
        } catch (error) {
          console.error('Error listing reports:', error);
          return corsResponse({ 
            error: 'Error listing reports',
            details: error instanceof Error ? error.message : String(error)
          }, 500);
        }
      }
      
      // Handle direct report download (for local development)
      // PRODUCTION NOTE: This endpoint is useful in both local development and production.
      // In production, it provides a direct download alternative to presigned URLs,
      // which can be helpful if users encounter issues with the presigned URLs.
      if (path.startsWith('/download/') && request.method === 'GET') {
        const taskId = path.split('/download/')[1];
        
        if (!taskId) {
          return corsResponse({ error: 'Missing task ID' }, 400);
        }
        
        try {
          // Check if the report exists in R2
          const reportObject = await env.RESEARCH_REPORTS.get(`${taskId}.json`);
          
          if (!reportObject) {
            return corsResponse({ error: 'Report not found' }, 404);
          }
          
          // Read the report data
          const reportData = await reportObject.json();
          
          // Return the report data directly
          return new Response(JSON.stringify(reportData, null, 2), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Content-Disposition': `attachment; filename="${taskId}.json"`
            }
          });
        } catch (error) {
          console.error('Error downloading report:', error);
          return corsResponse({ error: 'Internal server error' }, 500);
        }
      }
      
      // Log execution time at the end of the request
      const requestEndTime = Date.now();
      console.log(`Total request execution time: ${requestEndTime - requestStartTime}ms`);
      
      // Return 404 for unknown routes
      return corsResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Unhandled error:', error);
      
      // Log execution time for failed requests
      const requestEndTime = Date.now();
      console.log(`Failed request execution time: ${requestEndTime - requestStartTime}ms`);
      
      return corsResponse({ error: 'Internal server error' }, 500);
    }
  },
  
  // Helper method to determine content type based on file extension
  getContentType(path: string): string {
    if (path.endsWith('.html')) return 'text/html';
    if (path.endsWith('.css')) return 'text/css';
    if (path.endsWith('.js')) return 'application/javascript';
    if (path.endsWith('.json')) return 'application/json';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    if (path.endsWith('.svg')) return 'image/svg+xml';
    return 'text/plain';
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
        await this.state.storage.put('status', 'pending');
        await this.state.storage.put('createdAt', new Date().toISOString());
        await this.state.storage.put('logs', JSON.stringify([{
          timestamp: new Date().toISOString(),
          message: 'Task created and queued for processing',
          level: 'info'
        }]));
        
        console.log('Task initialized successfully');
        
        // Start the scraping process asynchronously
        this.startScraping().catch(error => {
          console.error('Error in scraping process:', error);
        });
        
        return new Response(JSON.stringify({ 
          status: 'pending',
          message: 'Task created and queued for processing',
          taskId
        }), {
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
    
    // Get configuration
    if (path === '/config' && request.method === 'GET') {
      try {
        // Return the current configuration
        const config = {
          model: (await this.state.storage.get('config_model') as string) || this.env.OPENAI_MODEL || 'gpt-4',
          promptPrice: (await this.state.storage.get('config_promptPrice') as string) || this.env.OPENAI_PROMPT_PRICE || '0.03',
          completionPrice: (await this.state.storage.get('config_completionPrice') as string) || this.env.OPENAI_COMPLETION_PRICE || '0.06'
        };
        
        return new Response(JSON.stringify({
          status: 'success',
          config
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error getting configuration:', error);
        return new Response(JSON.stringify({
          error: 'Failed to get configuration',
          details: error instanceof Error ? error.message : String(error)
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Update configuration
    if (path === '/config' && request.method === 'POST') {
      try {
        const body = await request.json() as { 
          model?: string;
          promptPrice?: string;
          completionPrice?: string;
        };
        
        console.log('Updating configuration:', body);
        
        // Store the configuration
        if (body.model) {
          await this.state.storage.put('config_model', body.model);
        }
        
        if (body.promptPrice) {
          await this.state.storage.put('config_promptPrice', body.promptPrice);
        }
        
        if (body.completionPrice) {
          await this.state.storage.put('config_completionPrice', body.completionPrice);
        }
        
        // Return the updated configuration
        const config = {
          model: (await this.state.storage.get('config_model') as string) || this.env.OPENAI_MODEL || 'gpt-4',
          promptPrice: (await this.state.storage.get('config_promptPrice') as string) || this.env.OPENAI_PROMPT_PRICE || '0.03',
          completionPrice: (await this.state.storage.get('config_completionPrice') as string) || this.env.OPENAI_COMPLETION_PRICE || '0.06'
        };
        
        return new Response(JSON.stringify({
          status: 'success',
          config
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error updating configuration:', error);
        return new Response(JSON.stringify({
          error: 'Failed to update configuration',
          details: error instanceof Error ? error.message : String(error)
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Get the task status
    if (path === '/status' && request.method === 'GET') {
      try {
        const status = await this.state.storage.get('status') as string | undefined || 'unknown';
        const targetUrl = await this.state.storage.get('targetUrl') as string | undefined;
        const taskId = await this.state.storage.get('taskId') as string | undefined;
        const createdAt = await this.state.storage.get('createdAt') as string | undefined;
        const updatedAt = await this.state.storage.get('updatedAt') as string | undefined;
        const completedAt = await this.state.storage.get('completedAt') as string | undefined;
        const progress = await this.state.storage.get('progress') as number | undefined;
        const error = await this.state.storage.get('error') as string | undefined;
        
        // Get the logs
        let logs = [];
        try {
          const logsString = await this.state.storage.get('logs') as string | undefined;
          if (logsString) {
            logs = JSON.parse(logsString);
          }
        } catch (logError) {
          console.error('Error parsing logs:', logError);
          // Continue with empty logs
        }
        
        return new Response(JSON.stringify({
          status,
          targetUrl,
          taskId,
          createdAt,
          updatedAt,
          completedAt,
          progress,
          error,
          logs: logs.slice(-10) // Return only the last 10 logs
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
    
    // Manually trigger the scraping process (useful for testing)
    if (path === '/start' && request.method === 'POST') {
      try {
        const currentStatus = await this.state.storage.get('status');
        
        if (currentStatus === 'in-progress') {
          return new Response(JSON.stringify({ 
            error: 'Task is already in progress'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        if (currentStatus === 'completed') {
          return new Response(JSON.stringify({ 
            error: 'Task is already completed'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        // Start the scraping process asynchronously
        this.startScraping().catch(error => {
          console.error('Error in scraping process:', error);
        });
        
        return new Response(JSON.stringify({ 
          status: 'in-progress',
          message: 'Scraping process started'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error starting scraping process:', error);
        return new Response(JSON.stringify({ 
          error: 'Error starting scraping process',
          message: error instanceof Error ? error.message : String(error)
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Reset a task (useful for testing)
    if (path === '/reset' && request.method === 'POST') {
      try {
        const targetUrl = await this.state.storage.get('targetUrl');
        const taskId = await this.state.storage.get('taskId');
        const createdAt = await this.state.storage.get('createdAt');
        
        // Reset the task status
        await this.state.storage.put('status', 'pending');
        await this.state.storage.put('updatedAt', new Date().toISOString());
        await this.state.storage.delete('completedAt');
        await this.state.storage.delete('progress');
        await this.state.storage.delete('error');
        
        // Add a log entry
        await this.addLogEntry('Task reset to pending status', 'info');
        
        return new Response(JSON.stringify({ 
          status: 'pending',
          message: 'Task reset to pending status',
          taskId
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error resetting task:', error);
        return new Response(JSON.stringify({ 
          error: 'Error resetting task',
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
  
  // Helper method to add a log entry
  private async addLogEntry(message: string, level: 'info' | 'warning' | 'error') {
    const logsString = await this.state.storage.get('logs') as string | undefined || '[]';
    const logs = JSON.parse(logsString);
    
    logs.push({
      timestamp: new Date().toISOString(),
      message,
      level
    });
    
    // Keep only the last 100 log entries to avoid excessive storage
    const trimmedLogs = logs.slice(-100);
    
    await this.state.storage.put('logs', JSON.stringify(trimmedLogs));
    console.log(`[${level.toUpperCase()}] ${message}`);
  }
  
  // Main method to handle the scraping process
  private async startScraping() {
    const scrapingStartTime = Date.now();
    let currentStage = 'initialization';
    let taskId = 'unknown';
    
    try {
      // Update the task status to in-progress
      await this.state.storage.put('status', 'in-progress');
      await this.state.storage.put('updatedAt', new Date().toISOString());
      await this.addLogEntry('Scraping process started', 'info');
      
      // Get the target URL
      const targetUrl = await this.state.storage.get('targetUrl') as string;
      taskId = await this.state.storage.get('taskId') as string || 'unknown';
      
      console.log(`[${taskId}] Starting scraping process for URL: ${targetUrl}`);
      
      if (!targetUrl) {
        throw new Error('Target URL not found in storage');
      }
      
      // Update progress
      await this.state.storage.put('progress', 20);
      await this.addLogEntry('Fetching target URL', 'info');
      
      // Fetch the target URL with improved error handling
      currentStage = 'fetching';
      const fetchStartTime = Date.now();
      console.log(`[${taskId}] Fetching URL with retry logic`);
      const response = await this.fetchWithRetry(targetUrl);
      const fetchEndTime = Date.now();
      console.log(`[${taskId}] URL fetched successfully in ${fetchEndTime - fetchStartTime}ms`);
      
      // Update progress
      await this.state.storage.put('progress', 40);
      await this.addLogEntry('URL fetched successfully, processing content', 'info');
      
      // Get the content type to determine how to process the response
      const contentType = response.headers.get('content-type') || '';
      console.log(`[${taskId}] Content type: ${contentType}`);
      
      // Initialize the extracted data object
      const extractedData: any = {
        title: '',
        description: '',
        keywords: '',
        author: '',
        ogTags: {},
        twitterTags: {},
        headings: {
          h1: [],
          h2: [],
          h3: []
        },
        links: [],
        images: []
      };
      
      // Process HTML content
      currentStage = 'parsing';
      const parsingStartTime = Date.now();
      if (contentType.includes('text/html')) {
        console.log(`[${taskId}] Processing HTML content with HTMLRewriter`);
        // Use HTMLRewriter to parse the HTML
        await this.parseHtmlWithRewriter(response.clone(), extractedData, targetUrl);
        console.log(`[${taskId}] HTMLRewriter processing complete`);
        console.log(`[${taskId}] Extracted title: "${extractedData.title}"`);
        console.log(`[${taskId}] Extracted description: "${extractedData.description}"`);
        console.log(`[${taskId}] Extracted ${extractedData.links.length} links`);
        console.log(`[${taskId}] Extracted ${extractedData.images.length} images`);
        console.log(`[${taskId}] Extracted headings: H1=${extractedData.headings.h1.length}, H2=${extractedData.headings.h2.length}, H3=${extractedData.headings.h3.length}`);
        
        // Get the raw HTML for storage (limited to avoid excessive storage)
        const html = await response.text();
        extractedData.rawHtml = html.substring(0, 10000);
        console.log(`[${taskId}] Stored ${extractedData.rawHtml.length} characters of raw HTML`);
      } else {
        // For non-HTML content, just store basic information
        console.log(`[${taskId}] Non-HTML content detected, storing basic information`);
        await this.addLogEntry(`Non-HTML content detected: ${contentType}`, 'info');
        extractedData.contentType = contentType;
        extractedData.rawContent = await response.text().then(text => text.substring(0, 10000));
        console.log(`[${taskId}] Stored ${extractedData.rawContent.length} characters of raw content`);
      }
      const parsingEndTime = Date.now();
      console.log(`[${taskId}] Content parsing completed in ${parsingEndTime - parsingStartTime}ms`);
      
      // Update progress
      await this.state.storage.put('progress', 70);
      await this.addLogEntry('Content processed, preparing report', 'info');
      
      // Create a report object
      currentStage = 'report_generation';
      const reportStartTime = Date.now();
      const report = {
        taskId,
        targetUrl,
        scrapedAt: new Date().toISOString(),
        metadata: {
          title: extractedData.title,
          description: extractedData.description,
          keywords: extractedData.keywords,
          author: extractedData.author,
          ogTags: extractedData.ogTags,
          twitterTags: extractedData.twitterTags
        },
        content: {
          headings: extractedData.headings,
          links: extractedData.links.slice(0, 100), // Limit to 100 links
          images: extractedData.images.slice(0, 50) // Limit to 50 images
        },
        rawHtml: extractedData.rawHtml || extractedData.rawContent,
        performance: {
          total_time_ms: 0, // Will be updated at the end
          fetch_time_ms: fetchEndTime - fetchStartTime,
          parsing_time_ms: parsingEndTime - parsingStartTime,
          storage_time_ms: 0 // Will be updated after storage
        }
      };
      
      // Store the report in R2
      currentStage = 'storage';
      const storageStartTime = Date.now();
      console.log(`[${taskId}] Storing report in R2`);
      const reportJson = JSON.stringify(report);
      await this.env.RESEARCH_REPORTS.put(`${taskId}.json`, reportJson, {
        httpMetadata: {
          contentType: 'application/json'
        }
      });
      const storageEndTime = Date.now();
      console.log(`[${taskId}] Report stored successfully in ${storageEndTime - storageStartTime}ms, size: ${reportJson.length} bytes`);
      
      // Update the performance metrics
      report.performance.storage_time_ms = storageEndTime - storageStartTime;
      report.performance.total_time_ms = Date.now() - scrapingStartTime;
      
      // Store the updated report with final performance metrics
      await this.env.RESEARCH_REPORTS.put(`${taskId}.json`, JSON.stringify(report), {
        httpMetadata: {
          contentType: 'application/json'
        }
      });
      
      // Update progress
      await this.state.storage.put('progress', 100);
      await this.state.storage.put('status', 'completed');
      await this.state.storage.put('completedAt', new Date().toISOString());
      await this.state.storage.put('performance', JSON.stringify(report.performance));
      await this.addLogEntry(`Scraping completed successfully in ${report.performance.total_time_ms}ms`, 'info');
      
      const scrapingEndTime = Date.now();
      console.log(`[${taskId}] Scraping process completed successfully in ${scrapingEndTime - scrapingStartTime}ms`);
      
      // Trigger the batch processing worker for detailed analysis
      try {
        await this.addLogEntry('Triggering detailed analysis worker', 'info');
        
        // Create a request to the detailed analysis worker
        const detailedAnalysisRequest = new Request(`http://${new URL(this.env.WORKER_URL || 'http://localhost:8788').host}/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            taskId,
            targetUrl
          })
        });
        
        // Send the request to trigger the detailed analysis
        const detailedAnalysisResponse = await fetch(detailedAnalysisRequest);
        
        if (!detailedAnalysisResponse.ok) {
          const errorText = await detailedAnalysisResponse.text();
          console.error(`[${taskId}] Error triggering detailed analysis:`, errorText);
          await this.addLogEntry(`Error triggering detailed analysis: ${errorText}`, 'warning');
        } else {
          const result = await detailedAnalysisResponse.json();
          console.log(`[${taskId}] Detailed analysis triggered successfully:`, result);
          await this.addLogEntry('Detailed analysis triggered successfully', 'info');
          
          // Update the task status to indicate detailed analysis is in progress
          await this.state.storage.put('detailedAnalysisStatus', 'in-progress');
          await this.state.storage.put('detailedAnalysisTriggeredAt', new Date().toISOString());
        }
      } catch (error) {
        console.error(`[${taskId}] Error triggering detailed analysis:`, error);
        await this.addLogEntry(`Error triggering detailed analysis: ${error instanceof Error ? error.message : String(error)}`, 'warning');
        // Continue with the current process even if detailed analysis fails to trigger
      }
      
    } catch (error) {
      console.error('Error in scraping process:', error);
      
      // Update the task status to error
      await this.state.storage.put('status', 'error');
      await this.state.storage.put('updatedAt', new Date().toISOString());
      await this.state.storage.put('error', error instanceof Error ? error.message : String(error));
      await this.state.storage.put('errorStage', currentStage);
      await this.addLogEntry(`Scraping failed at stage '${currentStage}': ${error instanceof Error ? error.message : String(error)}`, 'error');
      
      const scrapingEndTime = Date.now();
      console.log(`[${taskId}] Scraping process failed in ${scrapingEndTime - scrapingStartTime}ms at stage '${currentStage}'`);
    }
  }
  
  // Fetch with retry logic to handle temporary failures
  private async fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
    // Array of different user agents to rotate
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0'
    ];
    
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Use a different user agent for each retry
        const userAgent = userAgents[attempt % userAgents.length];
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          },
          redirect: 'follow', // Follow redirects automatically
          cf: {
            // Cloudflare-specific options
            cacheTtl: 0, // Don't cache the response
            cacheEverything: false
          }
        });
        
        // Check for redirect
        if (response.redirected) {
          await this.addLogEntry(`Redirected to: ${response.url}`, 'info');
        }
        
        // Handle HTTP errors
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }
        
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await this.addLogEntry(`Fetch attempt ${attempt + 1} failed: ${lastError.message}`, 'warning');
        
        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // If we get here, all retries failed
    throw lastError || new Error('Failed to fetch URL after multiple attempts');
  }
  
  // Parse HTML using HTMLRewriter
  private async parseHtmlWithRewriter(response: Response, extractedData: any, baseUrl: string): Promise<void> {
    console.log('Starting HTML parsing with HTMLRewriter');
    // Create a promise that will be resolved when parsing is complete
    return new Promise<void>((resolve) => {
      let parsingComplete = false;
      
      // Title handler
      class TitleHandler {
        private textContent = '';
        
        element(element: Element) {
          console.log('Found title element');
        }
        
        text(text: Text) {
          this.textContent += text.text;
        }
        
        getTitle(): string {
          console.log(`Extracted title: "${this.textContent.trim()}"`);
          return this.textContent.trim();
        }
      }
      
      // Meta tag handler
      class MetaHandler {
        constructor(private extractedData: any) {}
        
        element(element: Element) {
          const name = element.getAttribute('name')?.toLowerCase();
          const property = element.getAttribute('property')?.toLowerCase();
          const content = element.getAttribute('content');
          
          if (!content) return;
          
          if (name === 'description') {
            console.log(`Found meta description: "${content}"`);
            this.extractedData.description = content;
          } else if (name === 'keywords') {
            console.log(`Found meta keywords: "${content}"`);
            this.extractedData.keywords = content;
          } else if (name === 'author') {
            console.log(`Found meta author: "${content}"`);
            this.extractedData.author = content;
          } else if (property && property.startsWith('og:')) {
            // Open Graph tags
            const ogProperty = property.substring(3);
            console.log(`Found Open Graph tag ${property}: "${content}"`);
            this.extractedData.ogTags[ogProperty] = content;
          } else if (property && property.startsWith('twitter:')) {
            // Twitter card tags
            const twitterProperty = property.substring(8);
            console.log(`Found Twitter Card tag ${property}: "${content}"`);
            this.extractedData.twitterTags[twitterProperty] = content;
          }
        }
      }
      
      // Heading handler
      class HeadingHandler {
        private textContent = '';
        
        constructor(private level: 'h1' | 'h2' | 'h3', private extractedData: any) {}
        
        element(element: Element) {
          console.log(`Found ${this.level} element`);
        }
        
        text(text: Text) {
          this.textContent += text.text;
        }
        
        onEndTag() {
          if (this.textContent.trim()) {
            console.log(`Extracted ${this.level}: "${this.textContent.trim()}"`);
            this.extractedData.headings[this.level].push(this.textContent.trim());
            this.textContent = '';
          }
        }
      }
      
      // Link handler
      class LinkHandler {
        private textContent = '';
        private href = '';
        
        constructor(private extractedData: any, private baseUrl: string) {}
        
        element(element: Element) {
          const href = element.getAttribute('href');
          if (href) {
            this.href = href;
            
            // Skip empty URLs, javascript: URLs, and anchor links
            if (!href || href.startsWith('javascript:') || href === '#') {
              this.href = '';
              return;
            }
            
            // Resolve relative URLs
            try {
              this.href = new URL(href, this.baseUrl).href;
            } catch (e) {
              // If URL parsing fails, just use the original URL
              console.warn('Failed to parse URL:', href);
            }
          }
        }
        
        text(text: Text) {
          this.textContent += text.text;
        }
        
        onEndTag() {
          if (this.href) {
            // Only log every 10th link to avoid console spam
            if (this.extractedData.links.length % 10 === 0) {
              console.log(`Extracted link #${this.extractedData.links.length}: ${this.href}`);
            }
            
            this.extractedData.links.push({
              url: this.href,
              text: this.textContent.trim() || this.href
            });
            this.textContent = '';
            this.href = '';
          }
        }
      }
      
      // Image handler
      class ImageHandler {
        constructor(private extractedData: any, private baseUrl: string) {}
        
        element(element: Element) {
          const src = element.getAttribute('src');
          const alt = element.getAttribute('alt') || '';
          
          if (src) {
            let fullSrc = src;
            
            // Resolve relative URLs
            try {
              fullSrc = new URL(src, this.baseUrl).href;
            } catch (e) {
              // If URL parsing fails, just use the original URL
              console.warn('Failed to parse image URL:', src);
            }
            
            // Only log every 5th image to avoid console spam
            if (this.extractedData.images.length % 5 === 0) {
              console.log(`Extracted image #${this.extractedData.images.length}: ${fullSrc}`);
            }
            
            this.extractedData.images.push({
              url: fullSrc,
              alt: alt
            });
          }
        }
      }
      
      console.log('Setting up HTMLRewriter handlers');
      // Create instances of our handlers
      const titleHandler = new TitleHandler();
      const h1Handler = new HeadingHandler('h1', extractedData);
      const h2Handler = new HeadingHandler('h2', extractedData);
      const h3Handler = new HeadingHandler('h3', extractedData);
      const linkHandler = new LinkHandler(extractedData, baseUrl);
      const imageHandler = new ImageHandler(extractedData, baseUrl);
      
      console.log('Starting HTMLRewriter transformation');
      // Use HTMLRewriter to parse the HTML
      const rewrittenResponse = new HTMLRewriter()
        .on('title', titleHandler)
        .on('meta', new MetaHandler(extractedData))
        .on('h1', h1Handler)
        .on('h2', h2Handler)
        .on('h3', h3Handler)
        .on('a', linkHandler)
        .on('img', imageHandler)
        .transform(response);
      
      console.log('HTMLRewriter transformation created, processing response');
      // Process the rewritten response
      rewrittenResponse.text()
        .then(() => {
          console.log('HTMLRewriter processing complete');
          // Set the title from the title handler
          extractedData.title = titleHandler.getTitle();
          
          // Mark parsing as complete
          parsingComplete = true;
          resolve();
        })
        .catch((error: Error) => {
          console.error('Error parsing HTML with HTMLRewriter:', error);
          parsingComplete = true;
          resolve();
        });
      
      // Set a timeout to resolve the promise if parsing takes too long
      setTimeout(() => {
        if (!parsingComplete) {
          console.warn('HTML parsing timed out');
          resolve();
        }
      }, 10000); // 10 second timeout
    });
  }
  
  // Helper method to extract the title from HTML (fallback method)
  private extractTitle(html: string): string {
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    return titleMatch ? titleMatch[1].trim() : 'No title found';
  }
  
  // Helper method to extract the meta description from HTML (fallback method)
  private extractMetaDescription(html: string): string {
    const descriptionMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["'][^>]*>/i) ||
                            html.match(/<meta[^>]*content=["'](.*?)["'][^>]*name=["']description["'][^>]*>/i);
    return descriptionMatch ? descriptionMatch[1].trim() : 'No description found';
  }
  
  // Helper method to extract links from HTML (fallback method)
  private extractLinks(html: string, baseUrl: string): Array<{ url: string, text: string }> {
    const links: Array<{ url: string, text: string }> = [];
    const linkRegex = /<a[^>]*href=["'](.*?)["'][^>]*>(.*?)<\/a>/gi;
    
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const url = match[1].trim();
      const text = match[2].replace(/<[^>]*>/g, '').trim(); // Remove any HTML tags inside the link text
      
      // Skip empty URLs, javascript: URLs, and anchor links
      if (!url || url.startsWith('javascript:') || url === '#') {
        continue;
      }
      
      // Resolve relative URLs
      let fullUrl = url;
      try {
        fullUrl = new URL(url, baseUrl).href;
      } catch (e) {
        // If URL parsing fails, just use the original URL
        console.warn('Failed to parse URL:', url);
      }
      
      links.push({ url: fullUrl, text: text || fullUrl });
    }
    
    return links;
  }
} 