/**
 * Main entry point for the Cloudflare Worker
 * 
 * This file handles API requests and routes them to the appropriate handlers.
 */

import { v4 as uuidv4 } from 'uuid';
import { extractCompanyName } from './search_workers/utils';

// Define the API routes
const routes = {
  '/api/query': handleQuery,
  '/api/status': handleStatus,
  '/api/result': handleResult,
  '/research': handleResearch,
  '/compilation': handleCompilation
};

/**
 * Main fetch handler for the worker
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 * @returns {Promise<Response>} The response
 */
export default {
  async fetch(request, env, ctx) {
    // Set CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
    
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }
    
    // Parse the URL to get the pathname
    const url = new URL(request.url);
    const pathname = url.pathname;
    
    // Find the appropriate handler for the route
    const handler = routes[pathname];
    
    if (handler) {
      try {
        // Call the handler with the request, env, and ctx
        return await handler(request, env, ctx, corsHeaders);
      } catch (error) {
        console.error(`Error handling ${pathname}:`, error);
        
        // Return a JSON error response
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
    
    // If no handler is found, return a 404
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Not found'
      }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      }
    );
  }
};

/**
 * Handle query requests
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 * @param {Object} corsHeaders - CORS headers
 * @returns {Promise<Response>} The response
 */
async function handleQuery(request, env, ctx, corsHeaders) {
  // Only accept POST requests
  if (request.method !== 'POST') {
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
  
  // Parse the request body
  const data = await request.json();
  
  // Validate the query parameter
  if (!data.query) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Missing query parameter'
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      }
    );
  }
  
  // Extract the company name from the query
  const companyName = extractCompanyName(data.query);
  
  if (!companyName) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Could not extract company name from query'
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      }
    );
  }
  
  // Generate a job ID
  const jobId = uuidv4();
  
  // Define research categories
  const categories = [
    'overview',
    'customers',
    'products',
    'pricing',
    'competitors'
  ];
  
  // Create job metadata
  const metadata = {
    jobId,
    companyName,
    query: data.query,
    website: data.website || null,
    status: 'pending',
    categories: {},
    createdAt: new Date().toISOString()
  };
  
  // Initialize category status
  for (const category of categories) {
    metadata.categories[category] = 'pending';
  }
  
  // Store job metadata in R2
  try {
    await env.STORAGE_BUCKET.put(
      `jobs/${jobId}/metadata.json`,
      JSON.stringify(metadata),
      {
        httpMetadata: {
          contentType: 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('Error storing job metadata:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to store job metadata'
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
  
  // Notify the PartyKit server to start the research
  try {
    const partyKitUrl = env.PARTYKIT_URL || 'http://localhost:1999';
    
    // Prepare the request data
    const partyKitData = {
      action: 'startResearch',
      jobId,
      companyName,
      officialWebsite: data.website,
      categories,
      query: data.query
    };
    
    console.log(`Notifying PartyKit server at ${partyKitUrl}/party/searchagent with data:`, partyKitData);
    
    const response = await fetch(`${partyKitUrl}/party/searchagent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(partyKitData)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`PartyKit server returned ${response.status}: ${errorText}`);
      // Continue anyway, as the job is created
    } else {
      console.log('PartyKit server notified successfully');
    }
  } catch (error) {
    console.error('Error notifying PartyKit server:', error);
    // Continue anyway, as the job is created
  }
  
  // Return the job ID
  return new Response(
    JSON.stringify({
      success: true,
      jobId,
      message: 'Research job started'
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

/**
 * Handle status requests
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 * @param {Object} corsHeaders - CORS headers
 * @returns {Promise<Response>} The response
 */
async function handleStatus(request, env, ctx, corsHeaders) {
  // Only accept GET requests
  if (request.method !== 'GET') {
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
  
  // Parse the URL to get the jobId parameter
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');
  
  if (!jobId) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Missing jobId parameter'
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      }
    );
  }
  
  // Get job metadata from R2
  try {
    const metadataObject = await env.STORAGE_BUCKET.get(`jobs/${jobId}/metadata.json`);
    
    if (!metadataObject) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Job not found'
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    }
    
    const metadata = JSON.parse(await metadataObject.text());
    
    // Calculate progress
    const categories = Object.keys(metadata.categories);
    const completedCategories = categories.filter(
      category => metadata.categories[category] === 'completed'
    );
    
    const progress = {
      total: categories.length,
      completed: completedCategories.length
    };
    
    // Return the job status
    return new Response(
      JSON.stringify({
        success: true,
        jobId,
        status: metadata.status || 'pending',
        progress,
        categories: metadata.categories || {},
        message: metadata.message || null
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      }
    );
  } catch (error) {
    console.error('Error getting job status:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to get job status'
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
 * Handle result requests
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 * @param {Object} corsHeaders - CORS headers
 * @returns {Promise<Response>} The response
 */
async function handleResult(request, env, ctx, corsHeaders) {
  // Only accept GET requests
  if (request.method !== 'GET') {
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
  
  // Parse the URL to get the jobId parameter
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');
  
  if (!jobId) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Missing jobId parameter'
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      }
    );
  }
  
  // Get job metadata from R2
  try {
    const metadataObject = await env.STORAGE_BUCKET.get(`jobs/${jobId}/metadata.json`);
    
    if (!metadataObject) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Job not found'
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    }
    
    const metadata = JSON.parse(await metadataObject.text());
    
    // Check if the job is completed
    if (metadata.status !== 'completed') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Job not completed yet',
          status: metadata.status || 'pending'
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    }
    
    // Get the result file
    const resultObject = await env.STORAGE_BUCKET.get(`jobs/${jobId}/result.json`);
    
    if (!resultObject) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Result not found'
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    }
    
    const result = JSON.parse(await resultObject.text());
    
    // Return the result
    return new Response(
      JSON.stringify({
        success: true,
        jobId,
        result
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      }
    );
  } catch (error) {
    console.error('Error getting job result:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to get job result'
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
 * Handle research requests
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 * @param {Object} corsHeaders - CORS headers
 * @returns {Promise<Response>} The response
 */
async function handleResearch(request, env, ctx, corsHeaders) {
  try {
    // Import the research worker directly instead of forwarding to self
    const { default: researchWorker } = await import('./search_workers/research.js');
    
    // Pass the request directly to the research worker
    return await researchWorker.fetch(request, env, ctx);
  } catch (error) {
    console.error('Error handling research request:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: `Research worker error: ${error.message}`,
        stack: error.stack
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
 * Handle compilation requests
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 * @param {Object} corsHeaders - CORS headers
 * @returns {Promise<Response>} The response
 */
async function handleCompilation(request, env, ctx, corsHeaders) {
  try {
    // Import the compilation worker directly instead of forwarding to self
    const { default: compilationWorker } = await import('./search_workers/compilation.js');
    
    // Pass the request directly to the compilation worker
    return await compilationWorker.fetch(request, env, ctx);
  } catch (error) {
    console.error('Error handling compilation request:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: `Compilation worker error: ${error.message}`,
        stack: error.stack
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