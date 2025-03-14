/**
 * Detailed Analysis Worker
 * 
 * This worker performs comprehensive analysis of scraped website data to generate
 * a detailed report for product managers doing market research.
 */

import { 
  DurableObjectNamespace, 
  DurableObjectState, 
  R2Bucket,
  ExecutionContext
} from '@cloudflare/workers-types';
import * as litellm from 'litellm';

// Define the environment interface with our bindings
export interface Env {
  // Durable Object namespace for managing analysis tasks
  ANALYSIS_TASK_DO: DurableObjectNamespace;
  // R2 bucket for storing reports
  RESEARCH_REPORTS: R2Bucket;
  // OpenAI API Key for report generation
  OPENAI_API_KEY: string;
  // OpenAI model configuration
  OPENAI_MODEL: string;
  // Model pricing per 1K tokens (in USD)
  OPENAI_PROMPT_PRICE: string;
  OPENAI_COMPLETION_PRICE: string;
}

// Mock ResearchTaskDO class to satisfy the Durable Object binding
// This is not used in this worker but is required for the binding
export class ResearchTaskDO {
  constructor(state: DurableObjectState, env: Env) {
    // This is a mock class and does nothing
  }

  async fetch(request: Request): Promise<Response> {
    return new Response('This is a mock ResearchTaskDO class', { status: 501 });
  }
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

// Main worker handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return corsResponse({}, 204);
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    console.log('Detailed Analysis Worker received request:', request.method, path);
    
    try {
      // Handle analysis request
      if (path === '/analyze' && request.method === 'POST') {
        try {
          const body = await request.json() as { taskId?: string, targetUrl?: string };
          const { taskId, targetUrl } = body;
          
          if (!taskId) {
            return corsResponse({ error: 'Missing taskId in request body' }, 400);
          }
          
          // Create a Durable Object to manage the analysis task
          const id = env.ANALYSIS_TASK_DO.idFromName(taskId);
          const stub = env.ANALYSIS_TASK_DO.get(id);
          
          // Initialize the analysis task
          await stub.fetch('https://dummy-url/init', {
            method: 'POST',
            body: JSON.stringify({ taskId, targetUrl })
          });
          
          return corsResponse({
            status: 'queued',
            taskId,
            message: 'Detailed analysis queued'
          });
        } catch (error) {
          console.error('Error processing analysis request:', error);
          return corsResponse({ error: 'Failed to process request' }, 500);
        }
      }
      
      // Handle status check
      if (path.startsWith('/analysis-status/') && request.method === 'GET') {
        const taskId = path.split('/analysis-status/')[1];
        
        if (!taskId) {
          return corsResponse({ error: 'Missing task ID' }, 400);
        }
        
        try {
          // Get a stub for the Durable Object
          const id = env.ANALYSIS_TASK_DO.idFromName(taskId);
          const stub = env.ANALYSIS_TASK_DO.get(id);
          
          // Get the task status
          const response = await stub.fetch('https://dummy-url/status');
          
          // Parse the response as text first to handle any JSON parsing errors
          const responseText = await response.text();
          let result;
          
          try {
            result = JSON.parse(responseText);
          } catch (parseError) {
            console.error('Error parsing analysis status response:', parseError);
            return corsResponse({ 
              error: 'Error parsing analysis status response',
              responseText: responseText.substring(0, 100) // Include part of the response for debugging
            }, 500);
          }
          
          return corsResponse(result);
        } catch (error) {
          console.error('Error checking analysis status:', error);
          return corsResponse({ error: 'Internal server error' }, 500);
        }
      }
      
      // Handle report retrieval
      if (path.startsWith('/analysis-report/') && request.method === 'GET') {
        const taskId = path.split('/analysis-report/')[1];
        
        if (!taskId) {
          return corsResponse({ error: 'Missing task ID' }, 400);
        }
        
        try {
          // Check if the report exists in R2
          const reportObject = await env.RESEARCH_REPORTS.get(`${taskId}-detailed.json`);
          
          if (!reportObject) {
            return corsResponse({ error: 'Detailed report not found' }, 404);
          }
          
          // Get the report data
          try {
            const reportText = await reportObject.text();
            const reportData = JSON.parse(reportText);
            
            return corsResponse({
              status: 'completed',
              reportId: taskId,
              report: reportData
            });
          } catch (parseError) {
            console.error('Error parsing report:', parseError);
            return corsResponse({ 
              error: 'Error parsing report',
              details: parseError instanceof Error ? parseError.message : String(parseError)
            }, 500);
          }
        } catch (error) {
          console.error('Error retrieving report:', error);
          return corsResponse({ error: 'Internal server error' }, 500);
        }
      }
      
      // Return 404 for unknown routes
      return corsResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Unhandled error:', error);
      return corsResponse({ error: 'Internal server error' }, 500);
    }
  }
};

/**
 * Durable Object for managing detailed analysis tasks
 */
export class AnalysisTaskDO {
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
    
    console.log('Analysis Task DO received request to path:', path);
    
    // Initialize a new analysis task
    if (path === '/init' && request.method === 'POST') {
      try {
        const body = await request.json() as { taskId?: string, targetUrl?: string };
        const { taskId, targetUrl } = body;
        
        if (!taskId) {
          return new Response(JSON.stringify({ error: 'Missing taskId' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        // Store the task information
        await this.state.storage.put('taskId', taskId);
        await this.state.storage.put('targetUrl', targetUrl);
        await this.state.storage.put('status', 'pending');
        await this.state.storage.put('createdAt', new Date().toISOString());
        await this.state.storage.put('logs', JSON.stringify([{
          timestamp: new Date().toISOString(),
          message: 'Detailed analysis task created',
          level: 'info'
        }]));
        
        // Start the analysis process asynchronously
        this.startAnalysis().catch(error => {
          console.error('Error in analysis process:', error);
        });
        
        return new Response(JSON.stringify({
          status: 'initialized',
          taskId
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error initializing analysis task:', error);
        return new Response(JSON.stringify({
          error: 'Failed to initialize analysis task',
          details: error instanceof Error ? error.message : String(error)
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Get the task status
    if (path === '/status' && request.method === 'GET') {
      try {
        const status = await this.state.storage.get('status') as string | undefined || 'unknown';
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
    
    // Return 404 for unknown routes
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Add a log entry
  private async addLogEntry(message: string, level: 'info' | 'warning' | 'error') {
    try {
      const logsString = await this.state.storage.get('logs') as string | undefined;
      let logs = [];
      
      if (logsString) {
        try {
          logs = JSON.parse(logsString);
        } catch (e) {
          console.error('Error parsing logs:', e);
          logs = [];
        }
      }
      
      logs.push({
        timestamp: new Date().toISOString(),
        message,
        level
      });
      
      await this.state.storage.put('logs', JSON.stringify(logs));
    } catch (error) {
      console.error('Error adding log entry:', error);
    }
  }
  
  // Main method to handle the analysis process
  private async startAnalysis() {
    const analysisStartTime = Date.now();
    let currentStage = 'initialization';
    let taskId = 'unknown';
    
    try {
      // Update the task status to in-progress
      await this.state.storage.put('status', 'in-progress');
      await this.state.storage.put('updatedAt', new Date().toISOString());
      await this.addLogEntry('Analysis process started', 'info');
      
      // Get the task information
      taskId = await this.state.storage.get('taskId') as string || 'unknown';
      const targetUrl = await this.state.storage.get('targetUrl') as string;
      
      console.log(`[${taskId}] Starting detailed analysis for URL: ${targetUrl}`);
      
      // Update progress
      await this.state.storage.put('progress', 10);
      
      // Fetch the initial report from R2
      currentStage = 'fetching_initial_report';
      await this.addLogEntry('Fetching initial report', 'info');
      
      const initialReport = await this.env.RESEARCH_REPORTS.get(`${taskId}.json`);
      
      if (!initialReport) {
        throw new Error('Initial report not found in R2');
      }
      
      // Parse the initial report
      let reportData;
      try {
        const reportText = await initialReport.text();
        reportData = JSON.parse(reportText);
      } catch (parseError) {
        throw new Error(`Failed to parse initial report: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }
      
      // Update progress
      await this.state.storage.put('progress', 20);
      await this.addLogEntry('Initial report fetched and parsed', 'info');
      
      // Perform detailed analysis
      currentStage = 'detailed_analysis';
      await this.addLogEntry('Performing detailed analysis', 'info');
      
      // Analyze features
      const featuresStartTime = Date.now();
      const featuresAnalysis = await this.analyzeFeatures(reportData);
      const featuresEndTime = Date.now();
      console.log(`[${taskId}] Features analysis completed in ${featuresEndTime - featuresStartTime}ms`);
      
      // Update progress
      await this.state.storage.put('progress', 40);
      await this.addLogEntry('Features analysis completed', 'info');
      
      // Analyze pricing
      const pricingStartTime = Date.now();
      const pricingAnalysis = await this.analyzePricing(reportData);
      const pricingEndTime = Date.now();
      console.log(`[${taskId}] Pricing analysis completed in ${pricingEndTime - pricingStartTime}ms`);
      
      // Update progress
      await this.state.storage.put('progress', 60);
      await this.addLogEntry('Pricing analysis completed', 'info');
      
      // Analyze customers
      const customersStartTime = Date.now();
      const customersAnalysis = await this.analyzeCustomers(reportData);
      const customersEndTime = Date.now();
      console.log(`[${taskId}] Customers analysis completed in ${customersEndTime - customersStartTime}ms`);
      
      // Update progress
      await this.state.storage.put('progress', 80);
      await this.addLogEntry('Customers analysis completed', 'info');
      
      // Generate final report
      currentStage = 'report_generation';
      await this.addLogEntry('Generating final report', 'info');
      
      // Get token usage and cost information
      const tokenUsage = await this.state.storage.get('token_usage') as any || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      };
      
      const costEstimate = await this.state.storage.get('cost_estimate') as any || {
        prompt_cost: 0,
        completion_cost: 0,
        total_cost: 0
      };
      
      const detailedReport = {
        taskId,
        targetUrl,
        analyzedAt: new Date().toISOString(),
        basicInfo: {
          title: reportData.metadata.title,
          description: reportData.metadata.description,
          url: targetUrl
        },
        features: featuresAnalysis,
        pricing: pricingAnalysis,
        customers: customersAnalysis,
        performance: {
          total_time_ms: Date.now() - analysisStartTime,
          features_analysis_time_ms: featuresEndTime - featuresStartTime,
          pricing_analysis_time_ms: pricingEndTime - pricingStartTime,
          customers_analysis_time_ms: customersEndTime - customersStartTime
        },
        token_usage: tokenUsage,
        cost_estimate: costEstimate
      };
      
      // Store the detailed report in R2
      currentStage = 'storage';
      console.log(`[${taskId}] Storing detailed report in R2`);
      const reportJson = JSON.stringify(detailedReport);
      await this.env.RESEARCH_REPORTS.put(`${taskId}-detailed.json`, reportJson, {
        httpMetadata: {
          contentType: 'application/json'
        }
      });
      console.log(`[${taskId}] Detailed report stored successfully, size: ${reportJson.length} bytes`);
      
      // Update progress
      await this.state.storage.put('progress', 100);
      await this.state.storage.put('status', 'completed');
      await this.state.storage.put('completedAt', new Date().toISOString());
      await this.addLogEntry('Analysis completed successfully', 'info');
      
      const analysisEndTime = Date.now();
      console.log(`[${taskId}] Analysis process completed successfully in ${analysisEndTime - analysisStartTime}ms`);
    } catch (error) {
      console.error('Error in analysis process:', error);
      
      // Update the task status to error
      await this.state.storage.put('status', 'error');
      await this.state.storage.put('updatedAt', new Date().toISOString());
      await this.state.storage.put('error', error instanceof Error ? error.message : String(error));
      await this.state.storage.put('errorStage', currentStage);
      await this.addLogEntry(`Analysis failed at stage '${currentStage}': ${error instanceof Error ? error.message : String(error)}`, 'error');
      
      const analysisEndTime = Date.now();
      console.log(`[${taskId}] Analysis process failed in ${analysisEndTime - analysisStartTime}ms at stage '${currentStage}'`);
    }
  }
  
  // Analyze features
  private async analyzeFeatures(reportData: any): Promise<any> {
    const taskId = await this.state.storage.get('taskId') as string;
    
    try {
      // Prepare the prompt for OpenAI
      const prompt = `
I need to analyze the features of a product or service based on the following website content:

Title: ${reportData.metadata.title || 'N/A'}
Description: ${reportData.metadata.description || 'N/A'}
URL: ${reportData.url || 'N/A'}

Content:
${Array.isArray(reportData.content) 
  ? reportData.content.join('\n\n') 
  : reportData.content.text 
    ? reportData.content.text.join('\n\n')
    : JSON.stringify(reportData.content)
}

Based on this content, provide a comprehensive analysis of the product/service features in JSON format:

{
  "main_features": [
    {
      "name": "Feature Name",
      "description": "Detailed description of the feature",
      "benefits": ["Benefit 1", "Benefit 2"],
      "technical_details": "Any technical specifications or implementation details"
    }
  ],
  "unique_selling_points": [
    {
      "point": "Unique selling point",
      "description": "Why this is a competitive advantage"
    }
  ],
  "feature_categories": [
    {
      "category": "Category name (e.g., Security, Performance, etc.)",
      "features": ["Feature 1", "Feature 2"]
    }
  ],
  "limitations": [
    "Limitation 1", "Limitation 2"
  ]
}

If no specific features can be identified from the content, provide a structured response with empty arrays or appropriate placeholder values.

IMPORTANT: Your response MUST be valid JSON only, with no additional text before or after the JSON object.
`;
      
      // Call LLM using our helper function
      const systemPrompt = 'You are a product analyst specializing in feature analysis. Extract and categorize features from website content. ALWAYS respond with valid JSON only, with no additional text before or after the JSON object.';
      const content = await this.callLLM(systemPrompt, prompt, this.env.OPENAI_MODEL);
      
      // Parse the JSON response
      try {
        // Try to extract JSON if the response contains text before or after the JSON object
        let jsonContent = content.trim();
        
        // Look for JSON object start and end
        const startIdx = jsonContent.indexOf('{');
        const endIdx = jsonContent.lastIndexOf('}');
        
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonContent = jsonContent.substring(startIdx, endIdx + 1);
        }
        
        const parsedData = JSON.parse(jsonContent);
        return parsedData;
      } catch (parseError) {
        console.error(`[${taskId}] Error parsing features analysis:`, parseError);
        // Return a structured fallback response if parsing fails
        return {
          main_features: [],
          unique_selling_points: [],
          feature_categories: [],
          limitations: ["No features could be extracted from the provided content"],
          parsing_error: true,
          raw_content: content
        };
      }
    } catch (error) {
      console.error(`[${taskId}] Error analyzing features:`, error);
      // Return a structured fallback response if analysis fails
      return {
        main_features: [],
        unique_selling_points: [],
        feature_categories: [],
        limitations: ["An error occurred during feature analysis"],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  // Analyze pricing
  private async analyzePricing(reportData: any): Promise<any> {
    const taskId = await this.state.storage.get('taskId') as string;
    
    try {
      // Prepare the prompt for OpenAI
      const prompt = `
I need to analyze the pricing model of a product or service based on the following website content:

Title: ${reportData.metadata.title || 'N/A'}
Description: ${reportData.metadata.description || 'N/A'}
URL: ${reportData.url || 'N/A'}

Content:
${Array.isArray(reportData.content) 
  ? reportData.content.join('\n\n') 
  : reportData.content.text 
    ? reportData.content.text.join('\n\n')
    : JSON.stringify(reportData.content)
}

Based on this content, provide a comprehensive analysis of the pricing model in JSON format:

{
  "pricing_model": "Subscription / One-time / Freemium / etc.",
  "currency": "USD / EUR / etc.",
  "plans": [
    {
      "name": "Plan name",
      "price": "Price (e.g., $10/month)",
      "billing_cycle": "Monthly / Annual / One-time",
      "features": ["Feature 1", "Feature 2"],
      "limitations": ["Limitation 1", "Limitation 2"],
      "target_audience": "Who this plan is for"
    }
  ],
  "free_trial": {
    "available": true/false,
    "duration": "Duration of free trial if available"
  },
  "enterprise_option": {
    "available": true/false,
    "contact_info": "How to contact for enterprise pricing if available"
  },
  "pricing_transparency": "High / Medium / Low - assessment of how transparent the pricing is"
}

If no specific pricing information can be identified from the content, provide a structured response with empty arrays or appropriate placeholder values.

IMPORTANT: Your response MUST be valid JSON only, with no additional text before or after the JSON object.
`;
      
      // Call LLM using our helper function
      const systemPrompt = 'You are a pricing analyst specializing in business models. Extract and categorize pricing information from website content. ALWAYS respond with valid JSON only, with no additional text before or after the JSON object.';
      const content = await this.callLLM(systemPrompt, prompt, this.env.OPENAI_MODEL);
      
      // Parse the JSON response
      try {
        // Try to extract JSON if the response contains text before or after the JSON object
        let jsonContent = content.trim();
        
        // Look for JSON object start and end
        const startIdx = jsonContent.indexOf('{');
        const endIdx = jsonContent.lastIndexOf('}');
        
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonContent = jsonContent.substring(startIdx, endIdx + 1);
        }
        
        const parsedData = JSON.parse(jsonContent);
        return parsedData;
      } catch (parseError) {
        console.error(`[${taskId}] Error parsing pricing analysis:`, parseError);
        // Return a structured fallback response if parsing fails
        return {
          pricing_model: "Unknown",
          currency: "Unknown",
          plans: [],
          free_trial: {
            available: false,
            duration: "Unknown"
          },
          enterprise_option: {
            available: false,
            contact_info: "Unknown"
          },
          pricing_transparency: "Low",
          parsing_error: true,
          raw_content: content
        };
      }
    } catch (error) {
      console.error(`[${taskId}] Error analyzing pricing:`, error);
      // Return a structured fallback response if analysis fails
      return {
        pricing_model: "Unknown",
        currency: "Unknown",
        plans: [],
        free_trial: {
          available: false,
          duration: "Unknown"
        },
        enterprise_option: {
          available: false,
          contact_info: "Unknown"
        },
        pricing_transparency: "Low",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  // Analyze customers
  private async analyzeCustomers(reportData: any): Promise<any> {
    const taskId = await this.state.storage.get('taskId') as string;
    
    try {
      // Prepare the prompt for OpenAI
      const prompt = `
I need to analyze the target customers and market positioning based on the following website content:

Title: ${reportData.metadata.title || 'N/A'}
Description: ${reportData.metadata.description || 'N/A'}
URL: ${reportData.url || 'N/A'}

Content:
${Array.isArray(reportData.content) 
  ? reportData.content.join('\n\n') 
  : reportData.content.text 
    ? reportData.content.text.join('\n\n')
    : JSON.stringify(reportData.content)
}

Based on this content, provide a comprehensive analysis of the target customers and market positioning in JSON format:

{
  "target_segments": [
    {
      "segment": "Segment name (e.g., Small Businesses, Enterprise, etc.)",
      "description": "Description of this customer segment",
      "needs": ["Need 1", "Need 2"],
      "pain_points": ["Pain point 1", "Pain point 2"]
    }
  ],
  "industries": ["Industry 1", "Industry 2"],
  "company_size": ["Size 1 (e.g., SMB)", "Size 2 (e.g., Enterprise)"],
  "geographic_focus": ["Region 1", "Region 2"],
  "customer_testimonials": [
    {
      "company": "Company name if mentioned",
      "quote": "Testimonial quote if available",
      "industry": "Industry of the customer if mentioned"
    }
  ],
  "market_positioning": {
    "competitors": ["Competitor 1", "Competitor 2"],
    "differentiators": ["Differentiator 1", "Differentiator 2"],
    "value_proposition": "Overall value proposition"
  }
}

If no specific customer information can be identified from the content, provide a structured response with empty arrays or appropriate placeholder values.

IMPORTANT: Your response MUST be valid JSON only, with no additional text before or after the JSON object.
`;
      
      // Call LLM using our helper function
      const systemPrompt = 'You are a market analyst specializing in customer segmentation and market positioning. Extract and categorize customer information from website content. ALWAYS respond with valid JSON only, with no additional text before or after the JSON object.';
      const content = await this.callLLM(systemPrompt, prompt, this.env.OPENAI_MODEL);
      
      // Parse the JSON response
      try {
        // Try to extract JSON if the response contains text before or after the JSON object
        let jsonContent = content.trim();
        
        // Look for JSON object start and end
        const startIdx = jsonContent.indexOf('{');
        const endIdx = jsonContent.lastIndexOf('}');
        
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonContent = jsonContent.substring(startIdx, endIdx + 1);
        }
        
        const parsedData = JSON.parse(jsonContent);
        return parsedData;
      } catch (parseError) {
        console.error(`[${taskId}] Error parsing customers analysis:`, parseError);
        // Return a structured fallback response if parsing fails
        return {
          target_segments: [],
          industries: [],
          company_size: [],
          geographic_focus: [],
          customer_testimonials: [],
          market_positioning: {
            competitors: [],
            differentiators: [],
            value_proposition: "No clear value proposition could be identified"
          },
          parsing_error: true,
          raw_content: content
        };
      }
    } catch (error) {
      console.error(`[${taskId}] Error analyzing customers:`, error);
      // Return a structured fallback response if analysis fails
      return {
        target_segments: [],
        industries: [],
        company_size: [],
        geographic_focus: [],
        customer_testimonials: [],
        market_positioning: {
          competitors: [],
          differentiators: [],
          value_proposition: "An error occurred during customer analysis"
        },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Helper method to call LLM using LiteLLM
   */
  private async callLLM(systemPrompt: string, userPrompt: string, model?: string): Promise<string> {
    const taskId = await this.state.storage.get('taskId') as string;
    
    try {
      const llmModel = model || this.env.OPENAI_MODEL || 'gpt-4';
      
      if (!this.env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key is not configured');
      }
      
      // Enhance the system prompt to ensure JSON output
      const enhancedSystemPrompt = `${systemPrompt}\n\nIMPORTANT: You MUST respond with valid, properly formatted JSON only. Do not include any explanatory text, markdown formatting, or code blocks. Your entire response should be parseable as JSON.`;
      
      // Enhance the user prompt to emphasize JSON format
      const enhancedUserPrompt = `${userPrompt}\n\nRemember to respond with ONLY valid JSON. No explanations, no markdown formatting, no code blocks.`;
      
      const startTime = Date.now();
      const response = await litellm.completion({
        model: llmModel,
        messages: [
          {
            role: 'system',
            content: enhancedSystemPrompt
          },
          {
            role: 'user',
            content: enhancedUserPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000,
        apiKey: this.env.OPENAI_API_KEY
      });
      const endTime = Date.now();
      
      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content returned from LiteLLM API');
      }
      
      // Extract token usage information
      const tokenUsage = response.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      };
      
      // Calculate cost based on token usage and pricing
      const promptPrice = parseFloat(this.env.OPENAI_PROMPT_PRICE) || 0.03;
      const completionPrice = parseFloat(this.env.OPENAI_COMPLETION_PRICE) || 0.06;
      
      const promptCost = (tokenUsage.prompt_tokens / 1000) * promptPrice;
      const completionCost = (tokenUsage.completion_tokens / 1000) * completionPrice;
      const totalCost = promptCost + completionCost;
      
      // Store token usage and cost information
      const currentUsage = await this.state.storage.get('token_usage') as any || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      };
      
      const currentCost = await this.state.storage.get('cost_estimate') as any || {
        prompt_cost: 0,
        completion_cost: 0,
        total_cost: 0
      };
      
      const updatedUsage = {
        prompt_tokens: currentUsage.prompt_tokens + tokenUsage.prompt_tokens,
        completion_tokens: currentUsage.completion_tokens + tokenUsage.completion_tokens,
        total_tokens: currentUsage.total_tokens + tokenUsage.total_tokens
      };
      
      const updatedCost = {
        prompt_cost: currentCost.prompt_cost + promptCost,
        completion_cost: currentCost.completion_cost + completionCost,
        total_cost: currentCost.total_cost + totalCost
      };
      
      await this.state.storage.put('token_usage', updatedUsage);
      await this.state.storage.put('cost_estimate', updatedCost);
      
      // Log token usage and cost information
      console.log(`[${taskId}] LLM call completed in ${endTime - startTime}ms`);
      console.log(`[${taskId}] Token usage: ${tokenUsage.total_tokens} tokens (${tokenUsage.prompt_tokens} prompt, ${tokenUsage.completion_tokens} completion)`);
      console.log(`[${taskId}] Estimated cost: $${totalCost.toFixed(6)} ($${promptCost.toFixed(6)} prompt, $${completionCost.toFixed(6)} completion)`);
      
      // Try to parse the content as JSON to validate it
      try {
        JSON.parse(content);
        return content;
      } catch (parseError) {
        console.error(`[${taskId}] LiteLLM returned invalid JSON, attempting to fix...`);
        
        // If the response isn't valid JSON, try to extract JSON from it
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const extractedJson = jsonMatch[0];
          // Validate the extracted JSON
          try {
            JSON.parse(extractedJson);
            return extractedJson;
          } catch (e) {
            // If extraction failed, return a fallback JSON
            console.error(`[${taskId}] Failed to extract valid JSON from response`);
          }
        }
        
        // Create a fallback JSON response
        const fallbackJson = JSON.stringify({
          error: "Failed to parse LLM response as JSON",
          raw_content: content
        });
        
        return fallbackJson;
      }
    } catch (error) {
      console.error(`[${taskId}] LiteLLM API error:`, error);
      throw new Error(`LiteLLM API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 