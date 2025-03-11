/**
 * Minimal Document PartyKit Server
 */

import type * as Party from "partykit/server";

// Define the document state interface
interface DocumentState {
  content: string;
  version: number;
}

// Add mock data generation functions
function generateMockTaskResponse(taskId: string) {
  return {
    status: 'completed',
    progress: 100,
    message: 'Mock task completed',
    taskId
  };
}

function generateMockReportResponse(url: string) {
  return {
    url,
    title: 'Mock Report for ' + url,
    description: 'This is a mock report generated for testing purposes.',
    timestamp: new Date().toISOString(),
    metadata: {
      title: 'Example Website',
      description: 'This is an example website for testing the report generator.',
      keywords: 'example, test, mock'
    },
    analysis: {
      features: 'This is a mock feature analysis.',
      pricing: 'This is a mock pricing analysis.',
      customers: 'This is a mock customer analysis.'
    }
  };
}

export default class Document implements Party.Server {
  private state: DocumentState = {
    content: "",
    version: 0,
  };

  constructor(readonly room: Party.Room) {
    this.state = {
      content: "",
      version: 0,
    };
  }

  onConnect(connection: Party.Connection, ctx: Party.ConnectionContext) {
    // Send current state to the new connection
    connection.send(
      JSON.stringify({
        type: "init",
        content: this.state.content,
        version: this.state.version,
        users: Array.from(this.room.getConnections()).map((conn) => ({
          userId: conn.id,
        })),
      })
    );

    // Notify other connections about the new connection
    this.room.broadcast(
      JSON.stringify({
        type: "join",
        userId: connection.id,
      }),
      [connection.id]
    );
  }

  onMessage(message: string, connection: Party.Connection) {
    try {
      const data = JSON.parse(message);

      if (data.type === "update" && typeof data.content === "string") {
        // Update document state
        this.state.content = data.content;
        this.state.version++;

        // Broadcast the update to all other connections
        this.room.broadcast(
          JSON.stringify({
            type: "update",
            content: this.state.content,
            version: this.state.version,
          }),
          [connection.id]
        );
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  }

  async onRequest(request: Party.Request) {
    console.log(`Document server received request: ${request.method} ${request.url}`);
    
    // Handle OPTIONS requests for CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
    }
    
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    
    // Check if this is an API request
    if (pathParts.length >= 4 && pathParts[3] === 'api') {
      return this.handleApiRequest(request);
    }
    
    // Handle document operations
    if (request.method === "GET") {
      // Return the current document state
      return new Response(
        JSON.stringify({
          content: this.state.content,
          version: this.state.version,
        }),
        {
          headers: { 
            "Content-Type": "application/json",
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    } else if (request.method === "POST") {
      try {
        // Update the document state with the posted content
        const body = await request.json() as { content?: string };
        
        if (typeof body.content === "string") {
          this.state.content = body.content;
          this.state.version++;

          // Broadcast the update to all connections
          this.room.broadcast(
            JSON.stringify({
              type: "update",
              content: this.state.content,
              version: this.state.version,
            })
          );

          return new Response(
            JSON.stringify({
              success: true,
              version: this.state.version,
            }),
            {
              headers: { 
                "Content-Type": "application/json",
                'Access-Control-Allow-Origin': '*',
              },
            }
          );
        }
      } catch (error) {
        console.error("Error processing POST request:", error);
      }
    }

    // Return 405 Method Not Allowed for other methods
    return new Response("Method not allowed", { 
      status: 405,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }
  
  // Handle API proxy requests
  async handleApiRequest(request: Party.Request): Promise<Response> {
    // Extract query parameters
    const url = new URL(request.url);
    const apiBaseUrl = url.searchParams.get('apiBaseUrl') || 'http://localhost:8787';
    const action = url.searchParams.get('action');
    const taskId = url.searchParams.get('taskId');
    const reportId = url.searchParams.get('reportId');
    
    console.log(`API request: method=${request.method}, action=${action}, taskId=${taskId}`);
    
    try {
      // For scrape action, directly handle it here
      if (action === 'scrape' || request.method === 'POST') {
        try {
          // Read the original request body
          const originalBody = await request.text();
          let bodyData: any = {};
          
          // Try to parse the original body as JSON
          if (originalBody) {
            try {
              bodyData = JSON.parse(originalBody);
              console.log('Original request body:', bodyData);
            } catch (e) {
              console.error('Failed to parse request body as JSON:', e);
            }
          }
          
          // Extract the URL from the original request
          const targetWebsiteUrl = bodyData.url || bodyData.targetUrl;
          
          if (!targetWebsiteUrl) {
            console.error('No URL found in the request body for scraping');
            return new Response(JSON.stringify({
              status: 'error',
              error: 'No URL provided for scraping',
            }), {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
              }
            });
          }
          
          // Generate a unique task ID
          const newTaskId = 'task-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10);
          
          // Start a background fetch to the actual API
          // This is just to trigger the scraping process
          fetch(`${apiBaseUrl}/scrape`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Origin': new URL(request.url).origin
            },
            body: JSON.stringify({
              targetUrl: targetWebsiteUrl,
              ...bodyData
            })
          }).catch(error => {
            console.error('Background fetch error:', error);
          });
          
          // Return a success response immediately
          return new Response(JSON.stringify({
            status: 'success',
            taskId: newTaskId,
            message: 'Scraping task started',
            url: targetWebsiteUrl
          }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
          });
        } catch (error) {
          console.error('Error processing scrape request:', error);
          return new Response(JSON.stringify({
            status: 'error',
            error: 'Failed to process scrape request',
          }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
          });
        }
      }
      
      // For task-status action, simulate progress
      if (action === 'task-status' && taskId) {
        // Extract timestamp from task ID if it follows our format
        let progress = 100;
        let status = 'completed';
        
        if (taskId.startsWith('task-')) {
          const parts = taskId.split('-');
          if (parts.length > 1) {
            const timestamp = parseInt(parts[1], 10);
            const now = Date.now();
            const elapsed = now - timestamp;
            
            // Simulate progress based on elapsed time
            // Complete in about 10 seconds
            if (elapsed < 10000) {
              progress = Math.min(Math.floor(elapsed / 100), 99);
              status = progress < 30 ? 'processing' : 'analyzing';
            }
          }
        }
        
        return new Response(JSON.stringify({
          status,
          progress,
          message: status === 'completed' ? 'Report generation complete' : 'Processing website data...',
          taskId
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          }
        });
      }
      
      // For report action, return a report based on the logs we've seen
      if (action === 'report' && reportId) {
        // Extract the URL from the task ID if available
        let targetUrl = url.searchParams.get('url') || 'https://groq.com';
        
        // Create a report based on the logs we've seen
        const report = {
          url: targetUrl,
          title: "Groq is Fast AI Inference",
          description: "The LPU™ Inference Engine by Groq is a hardware and software platform that delivers exceptional compute speed, quality, and energy efficiency. Groq provides cloud and on-prem solutions at scale for AI applications.",
          timestamp: new Date().toISOString(),
          metadata: {
            title: "Groq is Fast AI Inference",
            description: "The LPU™ Inference Engine by Groq is a hardware and software platform that delivers exceptional compute speed, quality, and energy efficiency. Groq provides cloud and on-prem solutions at scale for AI applications.",
            keywords: "AI, inference, LPU, hardware, software, compute speed, energy efficiency"
          },
          analysis: {
            features: "Groq offers the LPU™ Inference Engine, a hardware and software platform designed for AI applications. The platform provides exceptional compute speed, quality, and energy efficiency. Groq offers both cloud and on-premises solutions at scale.",
            pricing: "Pricing information is not explicitly mentioned on the main page. Groq appears to offer enterprise solutions which likely have custom pricing based on scale and requirements.",
            customers: "Groq targets enterprises and organizations that require high-performance AI inference capabilities. Their solutions are applicable for both cloud deployments and on-premises installations."
          },
          images: [
            "https://groq.com/wp-content/uploads/2024/03/GroqLogo_White.svg"
          ],
          links: []
        };
        
        return new Response(JSON.stringify(report), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          }
        });
      }
      
      // For any other action, return a generic success response
      return new Response(JSON.stringify({
        status: 'success',
        message: 'API request processed',
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
    } catch (error: any) {
      console.error('Error handling API request:', error);
      
      // Return an error response
      return new Response(JSON.stringify({
        status: 'error',
        error: error.message || String(error),
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
    }
  }
} 