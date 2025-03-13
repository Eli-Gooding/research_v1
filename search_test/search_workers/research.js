/**
 * Research Worker
 * 
 * This worker is responsible for:
 * 1. Handling research for a specific category
 * 2. Storing the research results in R2
 * 3. Updating the job status
 */

import { callOpenAI, storeInR2, getFromR2 } from './utils.js';

// Add a helper function for consistent logging
function logWithTimestamp(message, data = null) {
  const timestamp = new Date().toISOString();
  const logPrefix = `[RESEARCH_WORKER ${timestamp}]`;
  
  if (data) {
    console.log(`${logPrefix} ${message}`, data);
  } else {
    console.log(`${logPrefix} ${message}`);
  }
}

/**
 * Get and parse JSON data from R2
 * @param {Object} env - Environment variables
 * @param {string} key - R2 object key
 * @returns {Promise<Object|null>} Parsed JSON object or null if not found or invalid
 */
async function getJsonFromR2(env, key) {
  logWithTimestamp(`Attempting to get JSON from R2: ${key}`);
  try {
    const data = await getFromR2(env, key);
    
    if (!data) {
      logWithTimestamp(`No data found in R2 for key: ${key}`);
      return null;
    }
    
    // Parse the JSON string
    logWithTimestamp(`Successfully retrieved data from R2 for key: ${key}`);
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error getting or parsing JSON from R2 (${key}):`, error);
    return null;
  }
}

/**
 * Store JSON data in R2
 * @param {Object} env - Environment variables
 * @param {string} key - R2 object key
 * @param {Object} data - Data to store
 * @returns {Promise<Object>} Result object
 */
async function storeJsonInR2(env, key, data) {
  logWithTimestamp(`Attempting to store JSON in R2: ${key}`);
  try {
    // Convert object to JSON string if needed
    const jsonString = typeof data === 'string' ? data : JSON.stringify(data);
    
    // Store in R2
    const result = await storeInR2(env, key, jsonString);
    logWithTimestamp(`Successfully stored data in R2 for key: ${key}`);
    return result;
  } catch (error) {
    console.error(`Error storing JSON in R2 (${key}):`, error);
    throw error;
  }
}

/**
 * Research a specific category for a company
 * @param {Object} env - Environment variables
 * @param {string} companyName - The name of the company
 * @param {string} website - The company's official website (optional)
 * @param {string} category - The category to research
 * @returns {Promise<Object>} The research result
 */
async function researchCategory(env, companyName, website, category) {
  logWithTimestamp(`Starting research for category: ${category}`, { companyName, website });
  
  let searchQuery = `${companyName} ${category}`;
  
  // Use the website in the query if available
  if (website && website.includes('http')) {
    const domain = website.split('//')[1].split('/')[0];
    searchQuery += ` site:${domain}`;
  }
  
  logWithTimestamp(`Generated search query: ${searchQuery}`);
  
  const systemPrompt = `
  You are a research assistant gathering information about ${companyName}'s ${category}.
  Provide detailed, factual information based on web search results.
  Include specific details when available.
  Cite your sources with URLs when possible.
  
  Structure your response with clear sections and bullet points when appropriate.
  Focus on the most relevant and recent information available.
  `;
  
  try {
    // Use standard gpt-4o model
    const modelToUse = 'gpt-4o';
    logWithTimestamp(`Calling OpenAI with model: ${modelToUse}`);
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: searchQuery }
    ];
    const options = {
      max_tokens: 1000
    };
    
    logWithTimestamp(`Sending request to OpenAI API Gateway`, { 
      model: modelToUse, 
      messageCount: messages.length,
      endpoint: env.AI_GATEWAY_ENDPOINT || 'Not configured'
    });
    
    const response = await callOpenAI(env, modelToUse, messages, options);
    logWithTimestamp(`Received response from OpenAI`, { 
      model: modelToUse,
      tokens: response.usage?.total_tokens || 'unknown',
      contentLength: response.choices?.[0]?.message?.content?.length || 0
    });
    
    return {
      content: response.choices[0].message.content,
      model: modelToUse,
      tokens: response.usage?.total_tokens || 0,
      success: true,
      searchQuery,
      completedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error researching with model: ${error.message}`);
    return {
      error: error.message,
      success: false,
      searchQuery,
      completedAt: new Date().toISOString()
    };
  }
}

/**
 * Update job metadata with a category result
 * @param {Object} env - Environment variables
 * @param {string} jobId - The job ID
 * @param {string} category - The category
 * @param {string} status - The status (completed, error)
 * @returns {Promise<Object>} The updated metadata
 */
async function updateJobMetadata(env, jobId, category, status) {
  logWithTimestamp(`Starting updateJobMetadata for job ${jobId}, category ${category}, status ${status}`);
  
  // Check if STORAGE_BUCKET is available
  if (!env.STORAGE_BUCKET) {
    const error = new Error('STORAGE_BUCKET is not available in environment');
    logWithTimestamp(`ERROR: ${error.message}`);
    throw error;
  }
  
  logWithTimestamp(`Attempting to get metadata for job ${jobId}`);
  
  // Get current metadata using our new JSON parser
  const metadata = await getJsonFromR2(env, `jobs/${jobId}/metadata.json`);
  
  if (!metadata) {
    const error = new Error(`Job metadata not found for job ${jobId}`);
    logWithTimestamp(`ERROR: ${error.message}`);
    
    // Try to create a new metadata object
    logWithTimestamp(`Attempting to create new metadata for job ${jobId}`);
    
    const newMetadata = {
      jobId,
      status: 'processing',
      categories: {
        [category]: status
      },
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
    
    try {
      await storeJsonInR2(env, `jobs/${jobId}/metadata.json`, newMetadata);
      logWithTimestamp(`Created new metadata for job ${jobId}`);
      return newMetadata;
    } catch (storeError) {
      logWithTimestamp(`ERROR creating new metadata: ${storeError.message}`, {
        stack: storeError.stack,
        jobId,
        category,
        status
      });
      throw error; // Throw the original error
    }
  }
  
  logWithTimestamp(`Successfully retrieved metadata for job ${jobId}`, {
    status: metadata.status,
    categories: Object.keys(metadata.categories || {}).length
  });
  
  // Update category status
  if (!metadata.categories) {
    metadata.categories = {};
  }
  
  metadata.categories[category] = status;
  
  // Check if all categories are complete
  const allComplete = Object.values(metadata.categories).every(
    s => s === 'completed' || s === 'error'
  );
  
  // If all categories are complete, trigger compilation
  if (allComplete) {
    metadata.readyForCompilation = true;
    logWithTimestamp(`All categories complete for job ${jobId}, marked for compilation`);
  }
  
  // Update completion time
  metadata.lastUpdated = new Date().toISOString();
  
  // Save updated metadata using our new JSON store function
  try {
    logWithTimestamp(`Saving updated metadata for job ${jobId}`);
    await storeJsonInR2(env, `jobs/${jobId}/metadata.json`, metadata);
    logWithTimestamp(`Successfully saved updated metadata for job ${jobId}`);
  } catch (error) {
    logWithTimestamp(`ERROR saving metadata: ${error.message}`, {
      stack: error.stack,
      jobId,
      category,
      status
    });
    throw error;
  }
  
  return metadata;
}

/**
 * The main handler for the research worker
 */
export default {
  async fetch(request, env, ctx) {
    logWithTimestamp(`Research worker received ${request.method} request to ${request.url}`);
    
    // Log environment variables
    logWithTimestamp('Research worker environment variables:', {
      OPENAI_API_KEY: env.OPENAI_API_KEY ? 'Set' : 'Not set',
      AI_GATEWAY_ENDPOINT: env.AI_GATEWAY_ENDPOINT ? 'Set' : 'Not set',
      STORAGE_BUCKET: env.STORAGE_BUCKET ? 'Set' : 'Not set',
      RESEARCH_BUCKET: env.RESEARCH_BUCKET ? 'Set' : 'Not set',
      PARTYKIT_URL: env.PARTYKIT_URL || 'http://localhost:1999'
    });
    
    // Set CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json'
    };
    
    // Handle CORS preflight request
    if (request.method === 'OPTIONS') {
      logWithTimestamp('Handling CORS preflight request');
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }
    
    try {
      if (request.method !== 'POST') {
        logWithTimestamp(`Rejecting ${request.method} request - only POST is allowed`);
        return new Response(JSON.stringify({ 
          error: 'Method not allowed' 
        }), { 
          status: 405,
          headers: corsHeaders 
        });
      }
      
      // Parse request body
      logWithTimestamp('Parsing request body');
      const requestBody = await request.text();
      logWithTimestamp(`Request body: ${requestBody}`);
      
      let parsedBody;
      try {
        parsedBody = JSON.parse(requestBody);
      } catch (error) {
        logWithTimestamp(`Error parsing request body: ${error.message}`);
        return new Response(JSON.stringify({ 
          error: 'Invalid JSON in request body' 
        }), { 
          status: 400,
          headers: corsHeaders
        });
      }
      
      const { 
        jobId, 
        companyName, 
        category, 
        categoryKey,
        website
      } = parsedBody;
      
      logWithTimestamp('Request parameters:', { 
        jobId, 
        companyName, 
        category, 
        categoryKey,
        website
      });
      
      // Validate required parameters
      if (!jobId || !companyName || !category) {
        logWithTimestamp('Missing required parameters');
        return new Response(JSON.stringify({ 
          error: 'Missing required parameters' 
        }), { 
          status: 400,
          headers: corsHeaders
        });
      }
      
      // Normalize category key if not provided
      const normalizedCategoryKey = categoryKey || category.replace(/ /g, '_').toLowerCase();
      logWithTimestamp(`Using normalized category key: ${normalizedCategoryKey}`);
      
      // Check environment variables
      logWithTimestamp('Environment variables:', {
        AI_GATEWAY_ENDPOINT: env.AI_GATEWAY_ENDPOINT ? 'Set' : 'Not set',
        PARTYKIT_URL: env.PARTYKIT_URL || 'http://localhost:1999',
        R2_BUCKET: env.RESEARCH_BUCKET ? 'Set' : 'Not set'
      });
      
      // Update category status to processing
      logWithTimestamp(`Updating job metadata for ${jobId}, setting ${normalizedCategoryKey} to 'processing'`);
      await updateJobMetadata(env, jobId, normalizedCategoryKey, 'processing');
      
      // Perform the research
      logWithTimestamp(`Starting research for ${companyName}, category: ${category}`);
      const result = await researchCategory(env, companyName, website, category);
      logWithTimestamp(`Research completed with success: ${result.success}`);
      
      // Store the result in R2 using our JSON-aware function
      logWithTimestamp(`Storing research result for ${normalizedCategoryKey}`);
      await storeJsonInR2(
        env, 
        `jobs/${jobId}/categories/${normalizedCategoryKey}.json`, 
        result
      );
      
      // Update job metadata
      const status = result.success ? 'completed' : 'error';
      logWithTimestamp(`Updating job metadata for ${jobId}, setting ${normalizedCategoryKey} to '${status}'`);
      const updatedMetadata = await updateJobMetadata(env, jobId, normalizedCategoryKey, status);
      
      // If all categories are complete, trigger compilation
      if (updatedMetadata.readyForCompilation) {
        // Send a request to the compilation worker via PartyKit
        const partyKitUrl = env.PARTYKIT_URL || 'http://localhost:1999';
        logWithTimestamp(`All categories complete, triggering compilation via PartyKit at ${partyKitUrl}`);
        
        const compileRequest = new Request(`${partyKitUrl}/party/searchagent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'compile',
            jobId
          })
        });
        
        // Send the request to PartyKit asynchronously
        logWithTimestamp(`Sending compilation request for job ${jobId}`);
        ctx.waitUntil(fetch(compileRequest).then(
          response => logWithTimestamp(`Compilation request response: ${response.status}`),
          error => logWithTimestamp(`Error sending compilation request: ${error.message}`)
        ));
      }
      
      logWithTimestamp(`Returning success response for ${jobId}, category: ${category}`);
      return new Response(JSON.stringify({
        jobId,
        category,
        categoryKey: normalizedCategoryKey,
        status,
        success: result.success
      }), {
        headers: corsHeaders
      });
    } catch (error) {
      console.error(`Research worker error: ${error.message}`);
      logWithTimestamp(`ERROR: ${error.message}`, { stack: error.stack });
      return new Response(JSON.stringify({
        error: error.message,
        stack: error.stack
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
}; 