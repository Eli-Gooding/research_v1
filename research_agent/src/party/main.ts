/**
 * Main PartyKit Server
 * 
 * This server handles the main functionality of the Research Agent:
 * - URL submission via POST /scrape
 * - Task status checking via GET /task/:id
 * - Report retrieval via GET /report/:id
 */

import type { Party, PartyRequest, PartyServer } from "partykit/server";
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Define the environment interface with our bindings
export interface Env {
  // R2 bucket for storing reports
  RESEARCH_REPORTS: {
    get(key: string): Promise<any>;
    put(key: string, value: string): Promise<any>;
    list(): Promise<{ objects: any[] }>;
  };
  // AI Gateway for report generation
  AI_GATEWAY: any;
  // OpenAI API Key for report generation
  OPENAI_API_KEY: string;
  // OpenAI model configuration
  OPENAI_MODEL: string;
  // Model pricing per 1K tokens (in USD)
  OPENAI_PROMPT_PRICE: string;
  OPENAI_COMPLETION_PRICE: string;
}

// Define the task data interface
interface TaskData {
  id: string;
  url: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  extractedData?: any;
  error?: string;
  logs: Array<{
    timestamp: string;
    message: string;
    level: 'info' | 'warning' | 'error';
  }>;
}

// Define the tasks storage interface
interface TasksStorage {
  [key: string]: TaskData;
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

export class MainServer implements PartyServer {
  constructor(readonly party: Party) {}

  // Store task data in the party's storage
  async onStart() {
    // Initialize any necessary state
    await this.party.storage.put("tasks", {} as TasksStorage);
  }

  // Handle HTTP requests
  async onRequest(req: PartyRequest) {
    // Start timing for performance tracking
    const requestStartTime = Date.now();
    
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return corsResponse({}, 204);
    }
    
    const url = new URL(req.url);
    const path = url.pathname;
    
    console.log('Request received:', req.method, path);
    
    try {
      // Serve static assets
      if (req.method === 'GET' && !path.startsWith('/api/')) {
        // Static assets are handled by PartyKit's serve configuration
        // If we get here, it means the asset wasn't found
        return new Response('Not found', { status: 404 });
      }
      
      // Handle scrape request
      if (path === '/scrape' && req.method === 'POST') {
        try {
          const body = await req.json() as { url?: string };
          const targetUrl = body.url;
          
          if (!targetUrl) {
            return corsResponse({ error: 'Missing URL in request body' }, 400);
          }
          
          // Generate a unique task ID
          const taskId = crypto.randomUUID();
          
          // Initialize task data
          const taskData: TaskData = {
            id: taskId,
            url: targetUrl,
            status: 'initializing',
            createdAt: new Date().toISOString(),
            logs: [{
              timestamp: new Date().toISOString(),
              message: `Task initialized with ID: ${taskId} and URL: ${targetUrl}`,
              level: 'info'
            }]
          };
          
          // Store task data
          const tasks = await this.party.storage.get<TasksStorage>("tasks") || {};
          tasks[taskId] = taskData;
          await this.party.storage.put("tasks", tasks);
          
          console.log(`Task initialized successfully`);
          
          // Start the scraping process in the background
          this.startScraping(taskId, targetUrl);
          
          // Return the task ID to the client
          return corsResponse({
            status: 'success',
            message: 'Scraping process started',
            taskId
          });
        } catch (error) {
          console.error('Error processing scrape request:', error);
          return corsResponse({ error: 'Failed to process request' }, 500);
        }
      }
      
      // Handle task status request
      if (path.startsWith('/task/') && req.method === 'GET') {
        const taskId = path.split('/').pop();
        
        if (!taskId) {
          return corsResponse({ error: 'Invalid task ID' }, 400);
        }
        
        // Get task data from storage
        const tasks = await this.party.storage.get<TasksStorage>("tasks") || {};
        const taskData = tasks[taskId];
        
        if (!taskData) {
          return corsResponse({ error: 'Task not found' }, 404);
        }
        
        return corsResponse(taskData);
      }
      
      // Handle report retrieval
      if (path.startsWith('/report/') && req.method === 'GET') {
        const reportId = path.split('/').pop();
        
        if (!reportId) {
          return corsResponse({ error: 'Invalid report ID' }, 400);
        }
        
        try {
          // Get the report from R2
          const report = await this.party.env.RESEARCH_REPORTS.get(`report-${reportId}.json`);
          
          if (!report) {
            return corsResponse({ error: 'Report not found' }, 404);
          }
          
          // Parse the report JSON
          const reportData = await report.json();
          
          return corsResponse(reportData);
        } catch (error) {
          console.error('Error retrieving report:', error);
          return corsResponse({ error: 'Failed to retrieve report' }, 500);
        }
      }
      
      // Handle reports listing
      if (path === '/reports' && req.method === 'GET') {
        try {
          // List all reports in the R2 bucket
          const listed = await this.party.env.RESEARCH_REPORTS.list();
          
          // Format the response
          const reports = listed.objects.map((obj: any) => {
            const reportId = obj.key.replace('report-', '').replace('.json', '');
            return {
              id: reportId,
              size: obj.size,
              uploaded: obj.uploaded
            };
          });
          
          console.log(`R2 bucket is accessible, found ${reports.length} objects`);
          
          return corsResponse({ reports });
        } catch (error: any) {
          console.error('Error listing reports:', error);
          return corsResponse({ error: 'Failed to list reports', details: error.message }, 500);
        }
      }
      
      // Trigger detailed analysis
      if (path === '/analyze' && req.method === 'POST') {
        try {
          const body = await req.json() as { taskId?: string };
          const { taskId } = body;
          
          if (!taskId) {
            return corsResponse({ error: 'Missing taskId in request body' }, 400);
          }
          
          // Get task data from storage
          const tasks = await this.party.storage.get<TasksStorage>("tasks") || {};
          const taskData = tasks[taskId];
          
          if (!taskData) {
            return corsResponse({ error: 'Task not found' }, 404);
          }
          
          // Connect to the analysis party
          const analysisParty = this.party.context.parties.analysis.get(taskId);
          
          // Send the analysis request
          const response = await analysisParty.fetch('/analyze', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              taskId,
              targetUrl: taskData.url
            })
          });
          
          // Return the response from the analysis party
          const responseData = await response.json();
          return corsResponse(responseData);
        } catch (error) {
          console.error('Error triggering analysis:', error);
          return corsResponse({ error: 'Failed to trigger analysis' }, 500);
        }
      }
      
      // If we get here, the request wasn't handled
      return corsResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Error handling request:', error);
      return corsResponse({ error: 'Internal server error' }, 500);
    }
  }

  // Start the scraping process in the background
  private async startScraping(taskId: string, targetUrl: string) {
    console.log(`[INFO] Scraping process started`);
    console.log(`[${taskId}] Starting scraping process for URL: ${targetUrl}`);
    
    try {
      // Update task status
      const tasks = await this.party.storage.get<TasksStorage>("tasks") || {};
      const taskData = tasks[taskId];
      
      if (!taskData) {
        console.error(`[${taskId}] Task not found`);
        return;
      }
      
      taskData.status = 'fetching';
      await this.addLogEntry(taskId, `Fetching URL with retry logic`, 'info');
      
      // Fetch the URL with retry logic
      console.log(`[INFO] Fetching target URL`);
      const response = await this.fetchWithRetry(targetUrl);
      
      // Update task status
      taskData.status = 'processing';
      await this.addLogEntry(taskId, `URL fetched successfully in ${Date.now() - new Date(taskData.createdAt).getTime()}ms`, 'info');
      console.log(`[${taskId}] URL fetched successfully in ${Date.now() - new Date(taskData.createdAt).getTime()}ms`);
      
      // Process the response
      console.log(`[INFO] URL fetched successfully, processing content`);
      const contentType = response.headers.get('content-type') || '';
      console.log(`[${taskId}] Content type: ${contentType}`);
      
      // Extract data based on content type
      let extractedData: any = {
        url: targetUrl,
        title: '',
        description: '',
        links: [],
        images: [],
        headings: { h1: [], h2: [], h3: [] },
        meta: {
          og: {},
          twitter: {}
        },
        rawHtml: ''
      };
      
      if (contentType.includes('text/html')) {
        console.log(`[${taskId}] Processing HTML content with HTMLRewriter`);
        await this.parseHtmlWithRewriter(response.clone(), extractedData, targetUrl);
      } else {
        await this.addLogEntry(taskId, `Unsupported content type: ${contentType}`, 'warning');
        console.warn(`[${taskId}] Unsupported content type: ${contentType}`);
      }
      
      // Store the raw HTML (limited to a reasonable size)
      const html = await response.text();
      extractedData.rawHtml = html.substring(0, 50000); // Limit to 50KB
      
      // Update task data
      taskData.status = 'completed';
      taskData.extractedData = extractedData;
      taskData.completedAt = new Date().toISOString();
      tasks[taskId] = taskData;
      await this.party.storage.put("tasks", tasks);
      
      // Store the report in R2
      await this.addLogEntry(taskId, `Storing report in R2`, 'info');
      const reportData = {
        id: taskId,
        url: targetUrl,
        extractedAt: new Date().toISOString(),
        data: extractedData
      };
      
      const startTime = Date.now();
      await this.party.env.RESEARCH_REPORTS.put(`report-${taskId}.json`, JSON.stringify(reportData));
      console.log(`[${taskId}] Report stored successfully in ${Date.now() - startTime}ms, size: ${JSON.stringify(reportData).length} bytes`);
      
      // Update task status
      taskData.status = 'report_generated';
      tasks[taskId] = taskData;
      await this.party.storage.put("tasks", tasks);
      
      console.log(`[INFO] Scraping completed successfully in ${Date.now() - new Date(taskData.createdAt).getTime()}ms`);
      await this.addLogEntry(taskId, `Scraping process completed successfully in ${Date.now() - new Date(taskData.createdAt).getTime()}ms`, 'info');
      
      // Trigger detailed analysis
      console.log(`[INFO] Triggering detailed analysis worker`);
      const analysisParty = this.party.context.parties.analysis.get(taskId);
      
      // Send the analysis request
      const analysisResponse = await analysisParty.fetch('/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          taskId,
          targetUrl
        })
      });
      
      const analysisData = await analysisResponse.json();
      console.log(`[${taskId}] Detailed analysis triggered successfully:`, analysisData);
      console.log(`[INFO] Detailed analysis triggered successfully`);
    } catch (error: any) {
      console.error(`[${taskId}] Error during scraping:`, error);
      
      // Update task status
      const tasks = await this.party.storage.get<TasksStorage>("tasks") || {};
      const taskData = tasks[taskId];
      
      if (taskData) {
        taskData.status = 'error';
        taskData.error = error.message || 'Unknown error';
        tasks[taskId] = taskData;
        await this.party.storage.put("tasks", tasks);
        await this.addLogEntry(taskId, `Error during scraping: ${error.message || 'Unknown error'}`, 'error');
      }
    }
  }

  // Add a log entry to the task
  private async addLogEntry(taskId: string, message: string, level: 'info' | 'warning' | 'error') {
    const tasks = await this.party.storage.get<TasksStorage>("tasks") || {};
    const taskData = tasks[taskId];
    
    if (!taskData) {
      console.error(`[${taskId}] Task not found when adding log entry`);
      return;
    }
    
    if (!taskData.logs) {
      taskData.logs = [];
    }
    
    taskData.logs.push({
      timestamp: new Date().toISOString(),
      message,
      level
    });
    
    tasks[taskId] = taskData;
    await this.party.storage.put("tasks", tasks);
  }

  // Fetch a URL with retry logic
  private async fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
    let retries = 0;
    let lastError: Error | null = null;
    
    while (retries < maxRetries) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Research Agent/1.0 (https://example.com/research-agent)'
          },
          redirect: 'follow'
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }
        
        return response;
      } catch (error) {
        lastError = error as Error;
        retries++;
        
        if (retries < maxRetries) {
          // Exponential backoff
          const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError || new Error(`Failed to fetch ${url} after ${maxRetries} retries`);
  }

  // Parse HTML with HTMLRewriter
  private async parseHtmlWithRewriter(response: Response, extractedData: any, baseUrl: string): Promise<void> {
    console.log('Starting HTML parsing with HTMLRewriter');
    console.log('Setting up HTMLRewriter handlers');
    
    // Create a new HTMLRewriter instance
    console.log('Starting HTMLRewriter transformation');
    
    // We need to use a different approach with HTMLRewriter in PartyKit
    // Create custom handlers with proper state management
    let currentTitle = '';
    let currentH1 = '';
    let currentH2 = '';
    let currentH3 = '';
    let currentLink = { href: '', text: '' };
    
    const rewriter = new HTMLRewriter()
      .on('title', {
        element(element) {
          console.log('Found title element');
        },
        text(text) {
          currentTitle += text.text;
          extractedData.title = currentTitle;
        }
      })
      .on('meta[name="description"]', {
        element(element) {
          const content = element.getAttribute('content');
          if (content) {
            console.log(`Found meta description: "${content}"`);
            extractedData.description = content;
          }
        }
      })
      .on('meta[name="keywords"]', {
        element(element) {
          const content = element.getAttribute('content');
          if (content) {
            console.log(`Found meta keywords: "${content}"`);
            extractedData.keywords = content;
          }
        }
      })
      .on('meta[property^="og:"]', {
        element(element) {
          const property = element.getAttribute('property');
          const content = element.getAttribute('content');
          if (property && content) {
            console.log(`Found Open Graph tag ${property}: "${content}"`);
            extractedData.meta.og[property.replace('og:', '')] = content;
          }
        }
      })
      .on('meta[name^="twitter:"]', {
        element(element) {
          const name = element.getAttribute('name');
          const content = element.getAttribute('content');
          if (name && content) {
            console.log(`Found Twitter Card tag ${name}: "${content}"`);
            extractedData.meta.twitter[name.replace('twitter:', '')] = content;
          }
        }
      })
      .on('h1', {
        element() {
          currentH1 = '';
        },
        text(text) {
          currentH1 += text.text;
        },
        comments() {
          if (currentH1.trim()) {
            extractedData.headings.h1.push(currentH1.trim());
          }
        }
      })
      .on('h2', {
        element() {
          currentH2 = '';
        },
        text(text) {
          currentH2 += text.text;
        },
        comments() {
          if (currentH2.trim()) {
            extractedData.headings.h2.push(currentH2.trim());
          }
        }
      })
      .on('h3', {
        element() {
          currentH3 = '';
        },
        text(text) {
          currentH3 += text.text;
        },
        comments() {
          if (currentH3.trim()) {
            extractedData.headings.h3.push(currentH3.trim());
          }
        }
      })
      .on('a', {
        element(element) {
          currentLink = {
            href: element.getAttribute('href') || '',
            text: ''
          };
        },
        text(text) {
          currentLink.text += text.text;
        },
        comments() {
          if (currentLink.href && currentLink.text.trim()) {
            // Resolve relative URLs
            let fullUrl = currentLink.href;
            if (currentLink.href.startsWith('/')) {
              const urlObj = new URL(baseUrl);
              fullUrl = `${urlObj.protocol}//${urlObj.host}${currentLink.href}`;
            } else if (!currentLink.href.startsWith('http')) {
              fullUrl = new URL(currentLink.href, baseUrl).href;
            }
            
            extractedData.links.push({
              url: fullUrl,
              text: currentLink.text.trim()
            });
          }
        }
      })
      .on('img', {
        element(element) {
          const src = element.getAttribute('src');
          const alt = element.getAttribute('alt') || '';
          
          if (src) {
            // Resolve relative URLs
            let fullSrc = src;
            if (src.startsWith('/')) {
              const urlObj = new URL(baseUrl);
              fullSrc = `${urlObj.protocol}//${urlObj.host}${src}`;
            } else if (!src.startsWith('http')) {
              fullSrc = new URL(src, baseUrl).href;
            }
            
            extractedData.images.push({
              url: fullSrc,
              alt
            });
          }
        }
      });
    
    console.log('HTMLRewriter transformation created, processing response');
    await rewriter.transform(response).text();
    
    console.log('HTMLRewriter processing complete');
    console.log(`Extracted title: "${extractedData.title}"`);
    console.log(`Extracted description: "${extractedData.description}"`);
    console.log(`Extracted ${extractedData.links.length} links`);
    console.log(`Extracted ${extractedData.images.length} images`);
    console.log(`Extracted headings: H1=${extractedData.headings.h1.length}, H2=${extractedData.headings.h2.length}, H3=${extractedData.headings.h3.length}`);
  }
} 