import type * as Party from "partykit/server";

export default class ApiProxy implements Party.Server {
  constructor(readonly room: Party.Room) {}

  async onRequest(request: Party.Request) {
    console.log(`API Proxy received request: ${request.method} ${request.url} for room ${this.room.id}`);
    console.log(`Request headers: ${JSON.stringify(Object.fromEntries(request.headers.entries()))}`);
    
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
    
    // Handle POST requests
    if (request.method === 'POST') {
      try {
        // Extract the API base URL from query parameters
        const url = new URL(request.url);
        const apiBaseUrl = url.searchParams.get('apiBaseUrl') || 'http://localhost:8787';
        
        // Parse the request body to get the action and other parameters
        let payload: { action?: string; url?: string } = {};
        try {
          payload = await request.json() as { action?: string; url?: string };
          console.log('Request payload:', payload);
        } catch (e) {
          console.error('Failed to parse request body:', e);
          return new Response(JSON.stringify({
            status: 'error',
            error: 'Invalid JSON in request body'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            }
          });
        }
        
        // Handle different actions
        const action = payload.action;
        
        if (action === 'scrape') {
          console.log('Handling scrape action');
          
          // Return a mock response for the scrape action
          return new Response(JSON.stringify({
            status: 'success',
            taskId: 'mock-task-id-' + Date.now(),
            message: 'Mock scraping task started',
            url: payload.url || 'https://example.com'
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
        
        // Unknown action
        return new Response(JSON.stringify({
          status: 'error',
          error: `Unknown action: ${action}`
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        });
      } catch (error: any) {
        console.error('Error in API proxy POST handler:', error);
        
        // Return an error response
        return new Response(JSON.stringify({
          status: 'error',
          error: error.message || String(error),
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        });
      }
    }
    
    // Handle GET requests
    if (request.method === 'GET') {
      try {
        // Extract query parameters
        const url = new URL(request.url);
        const apiBaseUrl = url.searchParams.get('apiBaseUrl') || 'http://localhost:8787';
        const taskId = url.searchParams.get('taskId');
        const reportId = url.searchParams.get('reportId');
        
        console.log(`GET request parameters: apiBaseUrl=${apiBaseUrl}, taskId=${taskId}, reportId=${reportId}`);
        
        // Handle task status request
        if (taskId) {
          console.log(`Handling task status request for taskId: ${taskId}`);
          
          // Return a mock response for task status
          return new Response(JSON.stringify({
            status: 'completed',
            progress: 100,
            message: 'Mock task completed'
          }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            }
          });
        }
        
        // Handle report request
        if (reportId) {
          console.log(`Handling report request for reportId: ${reportId}`);
          
          // Extract the URL from query parameters if available
          const mockUrl = url.searchParams.get('url') || 'https://example.com';
          
          // Return a mock response for the report
          return new Response(JSON.stringify({
            url: mockUrl,
            title: 'Mock Report for ' + mockUrl,
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
          }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            }
          });
        }
        
        // No specific request type identified
        return new Response(JSON.stringify({
          status: 'error',
          error: 'Missing required parameters'
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        });
      } catch (error: any) {
        console.error('Error in API proxy GET handler:', error);
        
        // Return an error response
        return new Response(JSON.stringify({
          status: 'error',
          error: error.message || String(error),
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        });
      }
    }
    
    // For any other method, return method not allowed
    return new Response(JSON.stringify({
      status: 'error',
      error: 'Method not allowed',
    }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }
} 