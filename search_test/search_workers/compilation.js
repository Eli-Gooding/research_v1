/**
 * Compilation Worker
 * 
 * This worker is responsible for:
 * 1. Gathering all category research results
 * 2. Generating a comprehensive final report
 * 3. Updating the job status to completed
 */

const { callOpenAI, storeInR2, getFromR2 } = require('./utils.js');

/**
 * Compile a research report from category results
 * @param {Object} env - Environment variables
 * @param {string} jobId - The job ID
 * @returns {Promise<Object>} The compilation result
 */
async function compileResearchReport(env, jobId) {
  // Get job metadata
  const metadata = await getFromR2(env, `jobs/${jobId}/metadata.json`);
  
  if (!metadata) {
    throw new Error(`Job metadata not found for job ${jobId}`);
  }
  
  const { companyName, categories } = metadata;
  
  // Gather all category results
  const categoryResults = {};
  
  for (const category of categories) {
    const result = await getFromR2(env, `jobs/${jobId}/categories/${category}.json`);
    
    if (!result || !result.success) {
      console.warn(`Missing or failed result for category ${category}`);
      continue;
    }
    
    categoryResults[category] = result.content;
  }
  
  // If no successful results, throw error
  if (Object.keys(categoryResults).length === 0) {
    throw new Error('No successful research results found');
  }
  
  // Combine all research results into a single context
  const combinedResearch = Object.entries(categoryResults)
    .map(([key, content]) => {
      // Convert key back to readable format
      const readableCategory = key.replace(/_/g, ' ');
      return `## ${readableCategory.charAt(0).toUpperCase() + readableCategory.slice(1)}\n${content}`;
    })
    .join('\n\n');
  
  const systemPrompt = `
  You are a business analyst creating a comprehensive research report about ${companyName}.
  
  Based on the provided research data, create a well-structured report that covers:
  1. Company Overview
  2. Target Customers and Audience
  3. Products and Services
  4. Key Features and Capabilities
  5. Pricing Structure
  6. Market Positioning and Competitive Analysis
  7. Summary and Insights
  
  Use markdown formatting for better readability.
  Maintain factual accuracy and cite sources where appropriate.
  Make the report cohesive and eliminate redundant information.
  `;
  
  // Call OpenAI to generate the final report
  try {
    const response = await callOpenAI(env, {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: combinedResearch }
      ],
      max_tokens: 4000
    });
    
    return {
      report: response.choices[0].message.content,
      tokens: response.usage?.total_tokens || 0,
      model: 'gpt-4o',
      success: true,
      completedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error compiling report: ${error.message}`);
    return {
      error: error.message,
      success: false,
      completedAt: new Date().toISOString()
    };
  }
}

/**
 * Update job metadata with compilation result
 * @param {Object} env - Environment variables
 * @param {string} jobId - The job ID
 * @param {Object} result - The compilation result
 * @returns {Promise<Object>} The updated metadata
 */
async function updateJobWithCompilation(env, jobId, result) {
  // Get current metadata
  const metadata = await getFromR2(env, `jobs/${jobId}/metadata.json`);
  
  if (!metadata) {
    throw new Error(`Job metadata not found for job ${jobId}`);
  }
  
  // Update metadata
  metadata.status = result.success ? 'completed' : 'error';
  metadata.completedAt = result.completedAt;
  
  if (!result.success) {
    metadata.error = result.error;
  }
  
  // Save updated metadata
  await storeInR2(env, `jobs/${jobId}/metadata.json`, metadata);
  
  return metadata;
}

/**
 * The main handler for the compilation worker
 */
export default {
  async fetch(request, env, ctx) {
    // Set CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    };
    
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
    
    try {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ 
          error: 'Method not allowed' 
        }), { 
          status: 405,
          headers: corsHeaders 
        });
      }
      
      // Parse request body
      const { jobId } = await request.json();
      
      // Validate required parameters
      if (!jobId) {
        return new Response(JSON.stringify({ 
          error: 'Missing jobId parameter' 
        }), { 
          status: 400,
          headers: corsHeaders
        });
      }
      
      // Compile the research report
      const result = await compileResearchReport(env, jobId);
      
      // Store the result in R2
      await storeInR2(env, `jobs/${jobId}/final_report.json`, result);
      
      // Update job metadata
      const updatedMetadata = await updateJobWithCompilation(env, jobId, result);
      
      return new Response(JSON.stringify({
        jobId,
        status: updatedMetadata.status,
        success: result.success,
        completedAt: result.completedAt
      }), {
        headers: corsHeaders
      });
    } catch (error) {
      console.error(`Compilation worker error: ${error.message}`);
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