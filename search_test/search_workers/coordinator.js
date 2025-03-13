/**
 * Coordinator Worker
 * 
 * This worker is responsible for:
 * 1. Determining if a query requires a simple answer or detailed research
 * 2. Handling simple queries directly
 * 3. Initiating the research process for complex queries by:
 *    - Extracting the company name
 *    - Finding the official website
 *    - Creating and dispatching parallel research tasks
 */

const { callOpenAI, storeInR2, getFromR2, generateJobId } = require('./utils.js');

/**
 * Determine if the query requires a simple answer or detailed research
 * @param {Object} env - Environment variables
 * @param {string} query - The user's query
 * @returns {Promise<string>} "simple" or "research"
 */
async function determineQueryType(env, query) {
  const systemPrompt = `
  You are an AI assistant that determines whether a user query requires:
  1. A simple answer that can be provided with a quick web search
  2. A detailed research about a company, requiring multiple searches and analysis
  
  If the query mentions a specific company and asks about its products, features, pricing, 
  customers, or market positioning, classify it as "research".
  
  Otherwise, classify it as "simple".
  
  Respond with ONLY "simple" or "research".
  `;
  
  try {
    const response = await callOpenAI(env, {
      model: "gpt-4o",
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ],
      max_tokens: 10
    });
    
    const result = response.choices[0].message.content.trim().toLowerCase();
    return result.includes('research') ? 'research' : 'simple';
  } catch (error) {
    console.error(`Error determining query type: ${error.message}`);
    // Default to simple if there's an error
    return 'simple';
  }
}

/**
 * Handle a simple query using web search
 * @param {Object} env - Environment variables
 * @param {string} query - The user's query
 * @returns {Promise<Object>} The search result
 */
async function handleSimpleQuery(env, query) {
  try {
    // Try with search-preview model
    const modelToUse = 'gpt-4o-search-preview';
    const response = await callOpenAI(env, {
      model: modelToUse,
      messages: [
        { 
          role: 'system', 
          content: 'You are a helpful assistant that provides accurate, concise answers using web search.' 
        },
        { role: 'user', content: query }
      ]
    });
    
    return {
      query_type: 'simple',
      original_query: query,
      response: response.choices[0].message.content,
      tokens_used: response.usage?.total_tokens || 0,
      model_used: modelToUse,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error with search-preview model: ${error.message}`);
    
    // Fallback to regular model if search-preview is not available
    const modelToUse = 'gpt-4o';
    const response = await callOpenAI(env, {
      model: modelToUse,
      messages: [
        { 
          role: 'system', 
          content: 'You are a helpful assistant that provides accurate, concise answers.' 
        },
        { role: 'user', content: query }
      ]
    });
    
    return {
      query_type: 'simple',
      original_query: query,
      response: response.choices[0].message.content,
      tokens_used: response.usage?.total_tokens || 0,
      model_used: modelToUse,
      fallback: true,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Extract the company name from the query
 * @param {Object} env - Environment variables
 * @param {string} query - The user's query
 * @returns {Promise<string|null>} The company name or null if not found
 */
async function extractCompanyName(env, query) {
  const systemPrompt = `
  Extract the company name from the following query. 
  If there is no specific company mentioned, respond with "None".
  Respond with ONLY the company name or "None".
  `;
  
  try {
    const response = await callOpenAI(env, {
      model: "gpt-4o",
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ],
      max_tokens: 50
    });
    
    const result = response.choices[0].message.content.trim();
    return result.toLowerCase() === 'none' ? null : result;
  } catch (error) {
    console.error(`Error extracting company name: ${error.message}`);
    return null;
  }
}

/**
 * Find the official website for a company
 * @param {Object} env - Environment variables
 * @param {string} companyName - The name of the company
 * @returns {Promise<string>} The URL of the official website
 */
async function findOfficialWebsite(env, companyName) {
  const searchQuery = `${companyName} official website`;
  
  try {
    // Try with search-preview model
    const modelToUse = 'gpt-4o-search-preview';
    const response = await callOpenAI(env, {
      model: modelToUse,
      messages: [
        { 
          role: 'system', 
          content: 'You are a helpful assistant that finds official company websites. Respond with ONLY the URL of the official website.' 
        },
        { role: 'user', content: searchQuery }
      ],
      max_tokens: 100
    });
    
    // Extract URL from the response
    const content = response.choices[0].message.content;
    const urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g;
    const urls = content.match(urlRegex);
    
    if (urls && urls.length > 0) {
      return urls[0];
    } else {
      // If no URL was found, extract it manually
      return content.trim();
    }
  } catch (error) {
    console.error(`Error finding official website: ${error.message}`);
    
    // Fallback to regular model
    try {
      const response = await callOpenAI(env, {
        model: "gpt-4o",
        messages: [
          { 
            role: 'system', 
            content: 'You are a helpful assistant that finds official company websites. Make your best guess at what the URL would be, even if you cannot access the internet. Respond with ONLY the URL.' 
          },
          { role: 'user', content: searchQuery }
        ],
        max_tokens: 100
      });
      
      return response.choices[0].message.content.trim();
    } catch (e) {
      return `https://www.${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
    }
  }
}

/**
 * The main handler for the coordinator worker
 */
export default {
  async fetch(request, env, ctx) {
    // Parse the URL and get the path
    const url = new URL(request.url);
    const path = url.pathname.split('/').filter(Boolean);
    
    // Handle CORS preflight request
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }
    
    // Set CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    };
    
    try {
      // Handle different endpoints
      if (request.method === 'POST' && path[0] === 'query') {
        // Handle new query request
        const { query } = await request.json();
        
        if (!query) {
          return new Response(JSON.stringify({ 
            error: 'Missing query parameter' 
          }), { 
            status: 400, 
            headers: corsHeaders 
          });
        }
        
        // Determine query type
        const queryType = await determineQueryType(env, query);
        
        if (queryType === 'simple') {
          // Handle simple query directly
          const result = await handleSimpleQuery(env, query);
          
          // Store the result in R2
          const resultId = `simple-${Date.now()}`;
          await storeInR2(env, `results/${resultId}.json`, result);
          
          return new Response(JSON.stringify({
            ...result,
            resultId
          }), { 
            headers: corsHeaders 
          });
        } else {
          // Handle research query
          const jobId = generateJobId();
          
          // Extract company name
          const companyName = await extractCompanyName(env, query);
          if (!companyName) {
            // Fall back to simple query if no company found
            const result = await handleSimpleQuery(env, query);
            
            // Store the result in R2
            const resultId = `simple-fallback-${Date.now()}`;
            await storeInR2(env, `results/${resultId}.json`, result);
            
            return new Response(JSON.stringify({
              ...result,
              resultId
            }), { 
              headers: corsHeaders 
            });
          }
          
          // Find official website
          const officialWebsite = await findOfficialWebsite(env, companyName);
          
          // Create job metadata
          const jobMetadata = {
            jobId,
            query,
            companyName,
            officialWebsite,
            status: 'processing',
            createdAt: new Date().toISOString(),
            categories: [
              'customers_and_target_audience',
              'products_and_services',
              'features_and_capabilities',
              'pricing_information',
              'market_positioning_and_competitors'
            ],
            categoryStatus: {}
          };
          
          // Initialize category statuses
          jobMetadata.categories.forEach(category => {
            jobMetadata.categoryStatus[category] = 'pending';
          });
          
          // Store job metadata in R2
          await storeInR2(env, `jobs/${jobId}/metadata.json`, jobMetadata);
          
          // Launch parallel research tasks
          const categories = [
            'customers and target audience',
            'products and services',
            'features and capabilities',
            'pricing information',
            'market positioning and competitors'
          ];
          
          // Create a request to the PartyKit server to handle the research
          const partyRequest = new Request(env.PARTY_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              action: 'startResearch',
              jobId,
              companyName,
              officialWebsite,
              categories,
              query
            })
          });
          
          // Send the request to PartyKit asynchronously
          ctx.waitUntil(fetch(partyRequest));
          
          // Return job ID immediately
          return new Response(JSON.stringify({ 
            jobId, 
            status: 'processing',
            companyName,
            officialWebsite,
            message: 'Research job started. Check status with /status?jobId={jobId}'
          }), {
            headers: corsHeaders
          });
        }
      } 
      else if (request.method === 'GET' && path[0] === 'status') {
        // Handle status check
        const jobId = url.searchParams.get('jobId');
        
        if (!jobId) {
          return new Response(JSON.stringify({ 
            error: 'Missing jobId parameter' 
          }), { 
            status: 400,
            headers: corsHeaders
          });
        }
        
        // Get job metadata from R2
        const metadata = await getFromR2(env, `jobs/${jobId}/metadata.json`);
        
        if (!metadata) {
          return new Response(JSON.stringify({ 
            error: 'Job not found' 
          }), { 
            status: 404,
            headers: corsHeaders
          });
        }
        
        // If job is completed, include the final report
        if (metadata.status === 'completed') {
          const finalReport = await getFromR2(env, `jobs/${jobId}/final_report.json`);
          return new Response(JSON.stringify({
            ...metadata,
            report: finalReport
          }), {
            headers: corsHeaders
          });
        }
        
        // Otherwise just return the metadata
        return new Response(JSON.stringify(metadata), {
          headers: corsHeaders
        });
      }
      else {
        return new Response(JSON.stringify({ 
          error: 'Invalid endpoint' 
        }), { 
          status: 404,
          headers: corsHeaders
        });
      }
    } catch (error) {
      console.error(`Coordinator error: ${error.message}`);
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