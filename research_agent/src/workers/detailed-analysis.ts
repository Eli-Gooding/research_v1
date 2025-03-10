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
        }
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
    console.log(`[${taskId}] Analyzing features`);
    
    try {
      // Prepare the prompt for OpenAI
      const prompt = `
Analyze the following website content and extract all features and offerings of the product or service:

TITLE: ${reportData.metadata.title || 'N/A'}
DESCRIPTION: ${reportData.metadata.description || 'N/A'}
HEADINGS:
${reportData.content.headings.h1.map((h: string) => `H1: ${h}`).join('\n')}
${reportData.content.headings.h2.slice(0, 10).map((h: string) => `H2: ${h}`).join('\n')}
${reportData.content.headings.h3.slice(0, 10).map((h: string) => `H3: ${h}`).join('\n')}

LINKS (sample):
${reportData.content.links.slice(0, 20).map((link: any) => `- ${link.text || 'N/A'}: ${link.url || 'N/A'}`).join('\n')}

Based on this content, provide a comprehensive analysis of the product/service features in JSON format:
1. List all features and capabilities
2. Categorize features (e.g., core features, advanced features, integrations)
3. Identify unique selling points or differentiators
4. Note any limitations or constraints mentioned

Format your response as valid JSON with the following structure:
{
  "core_features": [
    {"name": "Feature name", "description": "Brief description", "highlighted": true/false}
  ],
  "advanced_features": [
    {"name": "Feature name", "description": "Brief description", "highlighted": true/false}
  ],
  "integrations": [
    {"name": "Integration name", "description": "Brief description"}
  ],
  "unique_selling_points": [
    "USP 1", "USP 2"
  ],
  "limitations": [
    "Limitation 1", "Limitation 2"
  ]
}
`;
      
      // Call OpenAI via API
      const model = this.env.OPENAI_MODEL || 'gpt-4';
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: 'You are a product analyst specializing in feature analysis. Extract and categorize features from website content.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 2000
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const result = await response.json() as {
        choices: Array<{
          message: {
            content: string;
          };
        }>;
      };
      
      const content = result.choices[0].message.content;
      
      // Parse the JSON response
      try {
        return JSON.parse(content);
      } catch (parseError) {
        console.error(`[${taskId}] Error parsing features analysis:`, parseError);
        // Return the raw content if parsing fails
        return { raw: content };
      }
    } catch (error) {
      console.error(`[${taskId}] Error analyzing features:`, error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  // Analyze pricing
  private async analyzePricing(reportData: any): Promise<any> {
    const taskId = await this.state.storage.get('taskId') as string;
    console.log(`[${taskId}] Analyzing pricing`);
    
    try {
      // Prepare the prompt for OpenAI
      const prompt = `
Analyze the following website content and extract all pricing information, plans, and monetization strategies:

TITLE: ${reportData.metadata.title || 'N/A'}
DESCRIPTION: ${reportData.metadata.description || 'N/A'}
HEADINGS:
${reportData.content.headings.h1.map((h: string) => `H1: ${h}`).join('\n')}
${reportData.content.headings.h2.slice(0, 10).map((h: string) => `H2: ${h}`).join('\n')}
${reportData.content.headings.h3.slice(0, 10).map((h: string) => `H3: ${h}`).join('\n')}

LINKS (sample):
${reportData.content.links.slice(0, 20).map((link: any) => `- ${link.text || 'N/A'}: ${link.url || 'N/A'}`).join('\n')}

Based on this content, provide a comprehensive analysis of the pricing and monetization in JSON format:
1. List all pricing tiers/plans
2. Identify the pricing model (subscription, one-time, freemium, etc.)
3. Note any free trials or money-back guarantees
4. Compare pricing with industry standards (if possible to infer)
5. Identify any discounts or special offers

Format your response as valid JSON with the following structure:
{
  "pricing_model": "subscription/one-time/freemium/etc.",
  "currency": "USD/EUR/etc.",
  "plans": [
    {
      "name": "Plan name",
      "price": "Price (e.g., $10/month)",
      "billing_cycle": "monthly/annual/one-time",
      "features": ["Feature 1", "Feature 2"],
      "limitations": ["Limitation 1", "Limitation 2"]
    }
  ],
  "free_tier": {
    "available": true/false,
    "limitations": ["Limitation 1", "Limitation 2"]
  },
  "free_trial": {
    "available": true/false,
    "duration": "Duration (e.g., 14 days)"
  },
  "special_offers": [
    "Special offer 1", "Special offer 2"
  ],
  "pricing_analysis": "Brief analysis of the pricing strategy"
}
`;
      
      // Call OpenAI via API
      const model = this.env.OPENAI_MODEL || 'gpt-4';
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: 'You are a pricing analyst specializing in SaaS and product pricing. Extract and analyze pricing information from website content.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 2000
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const result = await response.json() as {
        choices: Array<{
          message: {
            content: string;
          };
        }>;
      };
      
      const content = result.choices[0].message.content;
      
      // Parse the JSON response
      try {
        return JSON.parse(content);
      } catch (parseError) {
        console.error(`[${taskId}] Error parsing pricing analysis:`, parseError);
        // Return the raw content if parsing fails
        return { raw: content };
      }
    } catch (error) {
      console.error(`[${taskId}] Error analyzing pricing:`, error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  // Analyze customers
  private async analyzeCustomers(reportData: any): Promise<any> {
    const taskId = await this.state.storage.get('taskId') as string;
    console.log(`[${taskId}] Analyzing customers`);
    
    try {
      // Prepare the prompt for OpenAI
      const prompt = `
Analyze the following website content and extract information about the target customers, user personas, and market positioning:

TITLE: ${reportData.metadata.title || 'N/A'}
DESCRIPTION: ${reportData.metadata.description || 'N/A'}
HEADINGS:
${reportData.content.headings.h1.map((h: string) => `H1: ${h}`).join('\n')}
${reportData.content.headings.h2.slice(0, 10).map((h: string) => `H2: ${h}`).join('\n')}
${reportData.content.headings.h3.slice(0, 10).map((h: string) => `H3: ${h}`).join('\n')}

LINKS (sample):
${reportData.content.links.slice(0, 20).map((link: any) => `- ${link.text || 'N/A'}: ${link.url || 'N/A'}`).join('\n')}

Based on this content, provide a comprehensive analysis of the target customers and market positioning in JSON format:
1. Identify the primary target audience and customer segments
2. Create detailed user personas for the main customer types
3. Analyze the company's market positioning and competitive stance
4. Identify the main pain points the product/service addresses
5. Note any customer testimonials or case studies mentioned

Format your response as valid JSON with the following structure:
{
  "target_audience": {
    "primary": "Description of primary audience",
    "secondary": "Description of secondary audience",
    "industries": ["Industry 1", "Industry 2"]
  },
  "user_personas": [
    {
      "name": "Persona name",
      "role": "Job role/title",
      "pain_points": ["Pain point 1", "Pain point 2"],
      "goals": ["Goal 1", "Goal 2"],
      "how_product_helps": "How the product addresses their needs"
    }
  ],
  "market_positioning": {
    "category": "Product/service category",
    "differentiators": ["Differentiator 1", "Differentiator 2"],
    "competitors": ["Competitor 1", "Competitor 2"]
  },
  "customer_evidence": {
    "testimonials": ["Testimonial 1", "Testimonial 2"],
    "case_studies": ["Case study 1", "Case study 2"],
    "logos_displayed": ["Company 1", "Company 2"]
  },
  "customer_analysis": "Brief analysis of how the company views and serves its customers"
}
`;
      
      // Call OpenAI via API
      const model = this.env.OPENAI_MODEL || 'gpt-4';
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: 'You are a market research analyst specializing in customer segmentation and user personas. Extract and analyze customer information from website content.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 2000
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const result = await response.json() as {
        choices: Array<{
          message: {
            content: string;
          };
        }>;
      };
      
      const content = result.choices[0].message.content;
      
      // Parse the JSON response
      try {
        return JSON.parse(content);
      } catch (parseError) {
        console.error(`[${taskId}] Error parsing customers analysis:`, parseError);
        // Return the raw content if parsing fails
        return { raw: content };
      }
    } catch (error) {
      console.error(`[${taskId}] Error analyzing customers:`, error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
} 