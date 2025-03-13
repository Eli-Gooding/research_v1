/**
 * API Handler for Search Agent
 * 
 * This worker is responsible for:
 * 1. Processing incoming API requests
 * 2. Validating and normalizing query parameters
 * 3. Creating research jobs
 * 4. Fetching job statuses
 * 5. Routing requests to appropriate services
 */

import { v4 as uuidv4 } from 'uuid';
import { storeInR2, getFromR2 } from './utils.js';

// CORS Headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

/**
 * Main request handler
 */
export default {
  /**
   * Process incoming fetch requests
   * @param {Request} request - The incoming request
   * @param {Object} env - Environment variables
   * @param {Object} ctx - Execution context
   * @returns {Response} The API response
   */
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    // Set CORS headers for all responses
    const headers = {
      'Content-Type': 'application/json',
      ...corsHeaders
    };

    // Parse the URL and route the request
    const url = new URL(request.url);
    const path = url.pathname.split('/').filter(Boolean);

    try {
      if (path[0] === 'api') {
        // API endpoint routing
        if (path[1] === 'query' && request.method === 'POST') {
          return await handleQueryRequest(request, env, ctx, headers);
        } else if (path[1] === 'status' && request.method === 'GET') {
          return await handleStatusRequest(request, env, ctx, headers);
        } else if (path[1] === 'result' && request.method === 'GET') {
          return await handleResultRequest(request, env, ctx, headers);
        }
      }

      // If no routes match, return 404
      return new Response(JSON.stringify({ 
        error: 'Not found',
        message: 'The requested endpoint does not exist'
      }), {
        status: 404,
        headers
      });
    } catch (error) {
      console.error('API error:', error);
      
      return new Response(JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      }), {
        status: 500,
        headers
      });
    }
  }
};

/**
 * Handle query API requests
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 * @param {Object} headers - Response headers
 * @returns {Response} The API response
 */
async function handleQueryRequest(request, env, ctx, headers) {
  // Parse the request body
  const data = await request.json();
  
  // Validate the request
  if (!data.query) {
    return new Response(JSON.stringify({
      error: 'Bad Request',
      message: 'Query parameter is required'
    }), {
      status: 400,
      headers
    });
  }

  // Normalize query
  const query = data.query.trim();
  
  // Generate a unique job ID
  const jobId = uuidv4();
  
  // Define research categories
  const categories = [
    'overview',
    'customers',
    'products',
    'pricing',
    'competitors'
  ];

  // Create a new job
  const jobData = {
    id: jobId,
    query,
    status: 'pending',
    created: new Date().toISOString(),
    categories: categories.reduce((acc, category) => {
      acc[category] = { status: 'pending' };
      return acc;
    }, {}),
    completedCategories: 0,
    totalCategories: categories.length
  };

  // Store job metadata in R2
  await storeInR2(env, `jobs/${jobId}/metadata.json`, JSON.stringify(jobData));

  // Notify PartyKit server
  try {
    await fetch(`${env.PARTYKIT_URL}/party/search-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'startResearch',
        jobId,
        query,
        categories
      })
    });
  } catch (error) {
    console.error('Error notifying PartyKit server:', error);
    // Continue even if notification fails
  }

  return new Response(JSON.stringify({
    jobId,
    message: 'Research job created successfully',
    status: 'pending'
  }), {
    status: 200,
    headers
  });
}

/**
 * Handle status API requests
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 * @param {Object} headers - Response headers
 * @returns {Response} The API response
 */
async function handleStatusRequest(request, env, ctx, headers) {
  // Parse the URL parameters
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');
  
  if (!jobId) {
    return new Response(JSON.stringify({
      error: 'Bad Request',
      message: 'Job ID parameter is required'
    }), {
      status: 400,
      headers
    });
  }

  // Get job metadata from R2
  try {
    const metadataJson = await getFromR2(env, `jobs/${jobId}/metadata.json`);
    
    if (!metadataJson) {
      return new Response(JSON.stringify({
        error: 'Not Found',
        message: 'Job not found'
      }), {
        status: 404,
        headers
      });
    }

    const metadata = JSON.parse(metadataJson);
    
    return new Response(JSON.stringify({
      jobId,
      status: metadata.status,
      progress: {
        completed: metadata.completedCategories,
        total: metadata.totalCategories
      },
      categories: metadata.categories
    }), {
      status: 200,
      headers
    });
  } catch (error) {
    console.error('Error retrieving job status:', error);
    
    return new Response(JSON.stringify({
      error: 'Internal Server Error',
      message: 'Failed to retrieve job status'
    }), {
      status: 500,
      headers
    });
  }
}

/**
 * Handle result API requests
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 * @param {Object} headers - Response headers
 * @returns {Response} The API response
 */
async function handleResultRequest(request, env, ctx, headers) {
  // Parse the URL parameters
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');
  const category = url.searchParams.get('category');
  
  if (!jobId) {
    return new Response(JSON.stringify({
      error: 'Bad Request',
      message: 'Job ID parameter is required'
    }), {
      status: 400,
      headers
    });
  }

  try {
    // Get job metadata first to check status
    const metadataJson = await getFromR2(env, `jobs/${jobId}/metadata.json`);
    
    if (!metadataJson) {
      return new Response(JSON.stringify({
        error: 'Not Found',
        message: 'Job not found'
      }), {
        status: 404,
        headers
      });
    }

    const metadata = JSON.parse(metadataJson);
    
    // If a specific category is requested
    if (category) {
      if (!metadata.categories[category]) {
        return new Response(JSON.stringify({
          error: 'Not Found',
          message: 'Category not found'
        }), {
          status: 404,
          headers
        });
      }
      
      // Get category result from R2
      const categoryJson = await getFromR2(env, `jobs/${jobId}/categories/${category}.json`);
      
      if (!categoryJson) {
        return new Response(JSON.stringify({
          error: 'Not Found',
          message: 'Category result not found'
        }), {
          status: 404,
          headers
        });
      }
      
      const categoryData = JSON.parse(categoryJson);
      
      return new Response(JSON.stringify({
        jobId,
        category,
        data: categoryData
      }), {
        status: 200,
        headers
      });
    } else {
      // If no category is specified and compilation is complete, return the compiled result
      if (metadata.status === 'completed') {
        const reportJson = await getFromR2(env, `jobs/${jobId}/report.json`);
        
        if (!reportJson) {
          return new Response(JSON.stringify({
            error: 'Not Found',
            message: 'Compiled report not found'
          }), {
            status: 404,
            headers
          });
        }
        
        const reportData = JSON.parse(reportJson);
        
        return new Response(JSON.stringify({
          jobId,
          status: metadata.status,
          data: reportData
        }), {
          status: 200,
          headers
        });
      } else {
        // If compilation is not complete, return the job status
        return new Response(JSON.stringify({
          jobId,
          status: metadata.status,
          message: 'Compilation not complete',
          progress: {
            completed: metadata.completedCategories,
            total: metadata.totalCategories
          }
        }), {
          status: 200,
          headers
        });
      }
    }
  } catch (error) {
    console.error('Error retrieving result:', error);
    
    return new Response(JSON.stringify({
      error: 'Internal Server Error',
      message: 'Failed to retrieve result'
    }), {
      status: 500,
      headers
    });
  }
} 