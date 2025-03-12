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
    
    console.log(`API request: method=${request.method}, action=${action}, taskId=${taskId}, reportId=${reportId}`);
    
    try {
      // Construct the target URL for the actual API
      let targetUrl = apiBaseUrl;
      
      // Add appropriate path based on the action
      if (action === 'scrape' || request.method === 'POST') {
        targetUrl += '/scrape';
      } else if (action === 'task-status' && taskId) {
        // Use path parameter format for task status (not query parameters)
        targetUrl += `/task/${encodeURIComponent(taskId)}`;
      } else if (action === 'report' && reportId) {
        // Check if the reportId already includes the -detailed suffix
        if (!reportId.endsWith('-detailed')) {
          // Use path parameter format for detailed report retrieval
          targetUrl += `/report/${encodeURIComponent(reportId)}-detailed`;
        } else {
          // The reportId already has the -detailed suffix
          targetUrl += `/report/${encodeURIComponent(reportId)}`;
        }
      } else if (action === 'direct-report' && reportId) {
        // The detailed report is stored in R2 with the filename format ${taskId}-detailed.json
        // We need to use this exact format to access it
        console.log(`Attempting to access report directly from R2 with reportId: ${reportId}`);
        
        if (!reportId.endsWith('-detailed')) {
          // Use the download endpoint for direct access to the detailed report
          targetUrl += `/download/${encodeURIComponent(reportId)}-detailed.json`;
          console.log(`Using path format for detailed report: ${targetUrl}`);
        } else {
          // The reportId already has the -detailed suffix, but we need to ensure it has the .json extension
          if (!reportId.endsWith('.json')) {
            targetUrl += `/download/${encodeURIComponent(reportId)}.json`;
            console.log(`Adding .json extension to reportId: ${targetUrl}`);
          } else {
            targetUrl += `/download/${encodeURIComponent(reportId)}`;
            console.log(`Using reportId as-is: ${targetUrl}`);
          }
        }
      }
      
      console.log(`Forwarding request to: ${targetUrl}`);
      
      // Clone the request headers
      const headers = new Headers();
      for (const [key, value] of request.headers.entries()) {
        if (key.toLowerCase() !== 'host') { // Skip the host header
          headers.set(key, value);
        }
      }
      
      // Set CORS headers
      headers.set('Origin', new URL(request.url).origin);
      headers.set('Accept', 'application/json, text/html');
      
      // Create the request options
      const requestOptions: RequestInit = {
        method: request.method,
        headers,
      };
      
      // Add body for non-GET requests
      if (request.method !== 'GET' && request.method !== 'HEAD') {
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
          
          // For scrape action, ensure targetUrl is included
          if (action === 'scrape' || bodyData.action === 'scrape') {
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
            
            // Create a new body with the required format
            const newBody = {
              targetUrl: targetWebsiteUrl,
              ...bodyData
            };
            
            requestOptions.body = JSON.stringify(newBody);
            console.log(`Forwarding modified request body: ${JSON.stringify(newBody)}`);
          } else {
            // For other actions, just forward the original body
            requestOptions.body = originalBody;
            console.log(`Forwarding original request body: ${originalBody}`);
          }
        } catch (error) {
          console.error('Error processing request body:', error);
        }
      }
      
      // Try to make the request to the specified URL
      try {
        // Forward the request to the actual API
        const response = await fetch(targetUrl, requestOptions);
        
        // Log the response
        console.log(`API response status: ${response.status}`);
        
        // Check if we got a successful response
        if (response.ok) {
          // Read the response body
          const responseBody = await response.text();
          console.log(`API response body: ${responseBody.substring(0, 200)}${responseBody.length > 200 ? '...' : ''}`);
          
          // Process the response as before
          const isHtml = responseBody.trim().startsWith('<!DOCTYPE html>') || 
                        responseBody.trim().startsWith('<html>');
          
          // For direct-report action, we need to try additional paths if we received HTML
          if (action === 'direct-report' && isHtml && reportId) {
            console.log('Received HTML for direct report, trying alternative storage paths');
            
            // Try alternative R2 paths
            const alternativePaths = [
              `/download/${encodeURIComponent(reportId)}-detailed.json`,
              `/download/${encodeURIComponent(reportId)}.json`,
              `/download/${encodeURIComponent(reportId)}`,
              `/report/${encodeURIComponent(reportId)}-detailed.json`,
              `/report/${encodeURIComponent(reportId)}-detailed`,
              `/report/${encodeURIComponent(reportId)}`,
              `/task/${encodeURIComponent(reportId)}`,
              `/download/report-${encodeURIComponent(reportId)}-detailed.json`,
              `/download/report-${encodeURIComponent(reportId)}.json`
            ];
            
            // Try each alternative path
            for (const path of alternativePaths) {
              try {
                console.log(`Trying alternative path: ${apiBaseUrl}${path}`);
                const altResponse = await fetch(`${apiBaseUrl}${path}`, requestOptions);
                
                console.log(`Alternative path response status: ${altResponse.status}`);
                
                if (altResponse.ok) {
                  const altResponseBody = await altResponse.text();
                  console.log(`Alternative path response: ${altResponseBody.substring(0, 100)}${altResponseBody.length > 100 ? '...' : ''}`);
                  
                  // Check if this is HTML or JSON
                  if (!altResponseBody.trim().startsWith('<!DOCTYPE html>') && 
                      !altResponseBody.trim().startsWith('<html>')) {
                    try {
                      // Try to parse as JSON
                      const jsonData = JSON.parse(altResponseBody);
                      console.log('Successfully retrieved JSON from alternative path');
                      
                      return new Response(JSON.stringify(jsonData), {
                        status: 200,
                        headers: {
                          'Content-Type': 'application/json',
                          'Access-Control-Allow-Origin': '*',
                          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                        }
                      });
                    } catch (jsonError) {
                      console.error('Failed to parse response as JSON:', jsonError);
                    }
                  } else {
                    // Extract JSON from HTML if possible
                    const jsonMatch = altResponseBody.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
                    if (jsonMatch && jsonMatch[1]) {
                      try {
                        const extractedJson = JSON.parse(jsonMatch[1].trim());
                        console.log('Successfully extracted JSON from HTML in alternative path');
                        
                        return new Response(JSON.stringify(extractedJson), {
                          status: 200,
                          headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                          }
                        });
                      } catch (extractError) {
                        console.error('Failed to extract JSON from HTML in alternative path:', extractError);
                      }
                    }
                  }
                }
              } catch (altError) {
                console.error(`Error trying alternative path ${path}:`, altError);
              }
            }
            
            // If none of the alternative paths worked, create a structured response from the HTML
            const titleMatch = responseBody.match(/<title>([^<]+)<\/title>/i);
            const bodyTextMatch = responseBody.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            
            const extractedData = {
              url: reportId ? reportId.split('-').pop() : 'unknown',
              title: titleMatch ? titleMatch[1] : 'Website Analysis',
              description: 'Analysis of website content and features',
              timestamp: new Date().toISOString(),
              content: bodyTextMatch ? bodyTextMatch[1].replace(/<[^>]+>/g, ' ').trim() : 'No content available',
              reportId: reportId
            };
            
            return new Response(JSON.stringify(extractedData), {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
              }
            });
          }
          
          // Check if the response is HTML
          if (isHtml) {
            console.log('Received HTML response, extracting data');
            
            // Extract data from HTML based on the action
            if (action === 'task-status') {
              // Look for the reportId in the HTML in various formats
              // First, look for a direct console log showing completed report stored
              const reportStoredMatch = responseBody.match(/Detailed report stored successfully[^"]*["']([^"']+)["']/i) ||
                                        responseBody.match(/report(?:Id)?['"]\s*:\s*['"]([^'"]+)['"]/i) ||
                                        responseBody.match(/\[([a-f0-9-]{36})\](?:[^[\]]*?)(?:completed|success)/i);
              
              // Look for standard JSON-like values in the HTML
              const statusMatch = responseBody.match(/status['"]\s*:\s*['"](\w+)['"]/i);
              const progressMatch = responseBody.match(/progress['"]\s*:\s*(\d+)/i);
              const messageMatch = responseBody.match(/message['"]\s*:\s*['"]([^'"]+)['"]/i);
              
              // Look for logs mentioning completed analysis
              const analysisCompletedMatch = responseBody.match(/analysis (?:process )?completed successfully in (\d+)ms/i) ||
                                             responseBody.match(/completed in (\d+)ms/i);
              
              // If we found a reportId in the HTML or console logs, the task is likely completed
              if (reportStoredMatch) {
                const extractedReportId = reportStoredMatch[1];
                console.log(`Found reportId in HTML response: ${extractedReportId}`);
                
                return new Response(JSON.stringify({
                  status: 'completed',
                  progress: 100,
                  message: 'Report generated successfully',
                  taskId: taskId,
                  reportId: extractedReportId
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
              // If we found evidence that analysis is completed but no reportId, assume the reportId is the taskId
              else if (analysisCompletedMatch || (statusMatch && statusMatch[1].toLowerCase() === 'completed')) {
                console.log(`Found evidence of completion but no reportId, using taskId as reportId: ${taskId}`);
                
                return new Response(JSON.stringify({
                  status: 'completed',
                  progress: 100,
                  message: analysisCompletedMatch ? `Analysis completed in ${analysisCompletedMatch[1]}ms` : 'Report generated successfully',
                  taskId: taskId,
                  reportId: taskId // Use the taskId as the reportId
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
              
              // Create a response with the extracted data for in-progress status
              const extractedData = {
                status: statusMatch ? statusMatch[1] : 'processing',
                progress: progressMatch ? parseInt(progressMatch[1], 10) : 50,
                message: messageMatch ? messageMatch[1] : 'Processing...',
                taskId: taskId
              };
              
              return new Response(JSON.stringify(extractedData), {
                status: 200,
                headers: {
                  'Content-Type': 'application/json',
                  'Access-Control-Allow-Origin': '*',
                  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                }
              });
            } else if (action === 'report') {
              // Try to extract report data from HTML
              
              // First look for specific log lines containing report data
              const reportJsonMatch = responseBody.match(/Detailed report[^{]*({[\s\S]*?})/i) ||
                                     responseBody.match(/({"url":[^}]*})/i);
              
              if (reportJsonMatch) {
                try {
                  // Try to parse the extracted JSON
                  const extractedJson = JSON.parse(reportJsonMatch[1].trim());
                  console.log('Successfully extracted report JSON from logs');
                  
                  return new Response(JSON.stringify(extractedJson), {
                    status: 200,
                    headers: {
                      'Content-Type': 'application/json',
                      'Access-Control-Allow-Origin': '*',
                      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                    }
                  });
                } catch (jsonError) {
                  console.error('Failed to parse extracted JSON from logs:', jsonError);
                }
              }
              
              // Look for pre tags that might contain JSON
              const preJsonMatch = responseBody.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
              if (preJsonMatch && preJsonMatch[1]) {
                try {
                  // Try to parse the JSON from the pre tag
                  const extractedJson = JSON.parse(preJsonMatch[1].trim());
                  console.log('Successfully extracted JSON from HTML pre tag');
                  
                  return new Response(JSON.stringify(extractedJson), {
                    status: 200,
                    headers: {
                      'Content-Type': 'application/json',
                      'Access-Control-Allow-Origin': '*',
                      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                    }
                  });
                } catch (jsonError) {
                  console.error('Failed to parse extracted content as JSON from pre tag:', jsonError);
                }
              }
              
              // Fallback to extracting basic metadata from the HTML
              const titleMatch = responseBody.match(/<title>([^<]+)<\/title>/i);
              const descriptionMatch = responseBody.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
              
              // Try to extract any content from the page
              const bodyContent = responseBody.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
              const extractedContent = bodyContent ? bodyContent[1].replace(/<[^>]+>/g, ' ').trim() : '';
              
              // Extract any other relevant data from the HTML
              const extractedData = {
                url: reportId ? reportId.split('-').pop() : 'unknown',
                title: titleMatch ? titleMatch[1] : 'Website Analysis',
                description: descriptionMatch ? descriptionMatch[1] : 'Analysis of website content and features',
                timestamp: new Date().toISOString(),
                content: extractedContent,
                reportId: reportId
              };
              
              // Check if we should try to access the report directly from R2
              console.log(`Attempting to construct R2 URL for reportId: ${reportId}`);
              
              return new Response(JSON.stringify(extractedData), {
                status: 200,
                headers: {
                  'Content-Type': 'application/json',
                  'Access-Control-Allow-Origin': '*',
                  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                }
              });
            }
            
            // For other actions, return the raw HTML with appropriate headers
            return new Response(responseBody, {
              status: response.status,
              headers: {
                'Content-Type': 'text/html',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
              }
            });
          }
          
          // Try to parse the response as JSON
          try {
            const jsonResponse = JSON.parse(responseBody);
            
            // Return the JSON response
            return new Response(JSON.stringify(jsonResponse), {
              status: response.status,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
              }
            });
          } catch (error) {
            console.error('Failed to parse response as JSON, returning raw response');
            
            // Return the raw response with appropriate headers
            return new Response(responseBody, {
              status: response.status,
              headers: {
                'Content-Type': response.headers.get('Content-Type') || 'text/plain',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
              }
            });
          }
        } else {
          // If response is not OK, return an error
          console.error(`API response returned non-OK status: ${response.status}`);
          return new Response(JSON.stringify({
            status: 'error',
            error: `API returned status ${response.status}`,
          }), {
            status: response.status,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
          });
        }
      } catch (error: any) {
        console.error('Error handling API request:', error);
        
        // Return an error response
        return new Response(JSON.stringify({
          status: 'error',
          error: error.message || 'Unknown error occurred',
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
    } catch (error: any) {
      console.error('Error handling API request:', error);
      
      // Return an error response
      return new Response(JSON.stringify({
        status: 'error',
        error: error.message || 'Unknown error occurred',
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