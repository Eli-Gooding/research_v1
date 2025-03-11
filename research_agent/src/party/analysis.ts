/**
 * Analysis PartyKit Server
 * 
 * This server handles the detailed analysis of scraped website data.
 * It uses OpenAI's GPT-4 to generate insights about the website.
 */

import type { Party, PartyRequest, PartyServer } from "partykit/server";
import * as litellm from 'litellm';

// Define the environment interface with our bindings
export interface Env {
  // R2 bucket for storing reports
  RESEARCH_REPORTS: {
    get(key: string): Promise<any>;
    put(key: string, value: string): Promise<any>;
    list(): Promise<{ objects: any[] }>;
  };
  // OpenAI API Key for report generation
  OPENAI_API_KEY: string;
  // OpenAI model configuration
  OPENAI_MODEL: string;
  // Model pricing per 1K tokens (in USD)
  OPENAI_PROMPT_PRICE: string;
  OPENAI_COMPLETION_PRICE: string;
}

// Define the task status interface
interface TaskStatus {
  taskId: string;
  targetUrl?: string;
  status: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  logs: Array<{
    timestamp: string;
    message: string;
    level: 'info' | 'warning' | 'error';
  }>;
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

export class AnalysisServer implements PartyServer {
  constructor(readonly party: Party) {}

  // Initialize the analysis task
  async onStart() {
    // Initialize task data
    const initialStatus: TaskStatus = {
      taskId: this.party.id,
      status: 'initialized',
      createdAt: new Date().toISOString(),
      logs: []
    };
    await this.party.storage.put("status", initialStatus);
  }

  // Handle HTTP requests
  async onRequest(req: PartyRequest) {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return corsResponse({}, 204);
    }
    
    const url = new URL(req.url);
    const path = url.pathname;
    
    console.log('Detailed Analysis Worker received request:', req.method, path);
    
    try {
      // Handle analysis request
      if (path === '/analyze' && req.method === 'POST') {
        try {
          const body = await req.json() as { taskId?: string, targetUrl?: string };
          const { taskId, targetUrl } = body;
          
          if (!taskId) {
            return corsResponse({ error: 'Missing taskId in request body' }, 400);
          }
          
          // Update task status
          const taskData = await this.party.storage.get<TaskStatus>("status") || {
            taskId: this.party.id,
            status: 'initialized',
            createdAt: new Date().toISOString(),
            logs: []
          };
          
          taskData.targetUrl = targetUrl;
          taskData.status = 'queued';
          await this.party.storage.put("status", taskData);
          
          // Start the analysis process in the background
          this.startAnalysis();
          
          return corsResponse({
            status: 'queued',
            taskId,
            message: 'Detailed analysis queued'
          });
        } catch (error: any) {
          console.error('Error processing analysis request:', error);
          return corsResponse({ error: 'Failed to process request' }, 500);
        }
      }
      
      // Handle analysis status request
      if (path === '/status' && req.method === 'GET') {
        const taskData = await this.party.storage.get<TaskStatus>("status");
        
        if (!taskData) {
          return corsResponse({ error: 'Task not found' }, 404);
        }
        
        return corsResponse(taskData);
      }
      
      // Handle analysis report request
      if (path === '/report' && req.method === 'GET') {
        try {
          const taskData = await this.party.storage.get<TaskStatus>("status");
          
          if (!taskData) {
            return corsResponse({ error: 'Task not found' }, 404);
          }
          
          if (taskData.status !== 'completed') {
            return corsResponse({ error: 'Analysis not completed yet' }, 400);
          }
          
          // Get the analysis report from storage
          const report = await this.party.storage.get("report");
          
          if (!report) {
            return corsResponse({ error: 'Report not found' }, 404);
          }
          
          return corsResponse(report);
        } catch (error: any) {
          console.error('Error retrieving analysis report:', error);
          return corsResponse({ error: 'Failed to retrieve report' }, 500);
        }
      }
      
      // If we get here, the request wasn't handled
      return corsResponse({ error: 'Not found' }, 404);
    } catch (error: any) {
      console.error('Error handling request:', error);
      return corsResponse({ error: 'Internal server error' }, 500);
    }
  }

  // Start the analysis process in the background
  private async startAnalysis() {
    try {
      // Get task data
      const taskData = await this.party.storage.get<TaskStatus>("status");
      
      if (!taskData) {
        console.error('Task data not found');
        return;
      }
      
      // Update task status
      taskData.status = 'analyzing';
      taskData.startedAt = new Date().toISOString();
      await this.party.storage.put("status", taskData);
      
      // Add log entry
      await this.addLogEntry(`Starting detailed analysis for URL: ${taskData.targetUrl}`, 'info');
      console.log(`[${taskData.taskId}] Starting detailed analysis for URL: ${taskData.targetUrl}`);
      
      // Get the report from R2
      const report = await this.party.env.RESEARCH_REPORTS.get(`report-${taskData.taskId}.json`);
      
      if (!report) {
        await this.addLogEntry('Report not found in R2', 'error');
        console.error(`[${taskData.taskId}] Report not found in R2`);
        
        // Update task status
        taskData.status = 'error';
        taskData.error = 'Report not found in R2';
        await this.party.storage.put("status", taskData);
        return;
      }
      
      // Parse the report JSON
      const reportData = await report.json();
      
      // Perform detailed analysis
      const analysisResults = {
        taskId: taskData.taskId,
        url: taskData.targetUrl,
        analyzedAt: new Date().toISOString(),
        features: null,
        pricing: null,
        customers: null
      };
      
      // Analyze features
      await this.addLogEntry('Analyzing features', 'info');
      const featuresStartTime = Date.now();
      analysisResults.features = await this.analyzeFeatures(reportData);
      await this.addLogEntry(`Features analysis completed in ${Date.now() - featuresStartTime}ms`, 'info');
      console.log(`[${taskData.taskId}] Features analysis completed in ${Date.now() - featuresStartTime}ms`);
      
      // Analyze pricing
      await this.addLogEntry('Analyzing pricing', 'info');
      const pricingStartTime = Date.now();
      analysisResults.pricing = await this.analyzePricing(reportData);
      await this.addLogEntry(`Pricing analysis completed in ${Date.now() - pricingStartTime}ms`, 'info');
      console.log(`[${taskData.taskId}] Pricing analysis completed in ${Date.now() - pricingStartTime}ms`);
      
      // Analyze customers
      await this.addLogEntry('Analyzing customers', 'info');
      const customersStartTime = Date.now();
      analysisResults.customers = await this.analyzeCustomers(reportData);
      await this.addLogEntry(`Customers analysis completed in ${Date.now() - customersStartTime}ms`, 'info');
      console.log(`[${taskData.taskId}] Customers analysis completed in ${Date.now() - customersStartTime}ms`);
      
      // Store the analysis report
      await this.addLogEntry('Storing detailed report in R2', 'info');
      console.log(`[${taskData.taskId}] Storing detailed report in R2`);
      
      // Store in R2
      await this.party.env.RESEARCH_REPORTS.put(`analysis-${taskData.taskId}.json`, JSON.stringify(analysisResults));
      
      // Store in party storage
      await this.party.storage.put("report", analysisResults);
      
      // Update task status
      taskData.status = 'completed';
      taskData.completedAt = new Date().toISOString();
      await this.party.storage.put("status", taskData);
      
      console.log(`[${taskData.taskId}] Detailed report stored successfully, size: ${JSON.stringify(analysisResults).length} bytes`);
      await this.addLogEntry(`Analysis process completed successfully in ${Date.now() - new Date(taskData.startedAt || taskData.createdAt).getTime()}ms`, 'info');
      console.log(`[${taskData.taskId}] Analysis process completed successfully in ${Date.now() - new Date(taskData.startedAt || taskData.createdAt).getTime()}ms`);
    } catch (error: any) {
      console.error('Error during analysis:', error);
      
      // Update task status
      const taskData = await this.party.storage.get<TaskStatus>("status");
      
      if (taskData) {
        taskData.status = 'error';
        taskData.error = error.message || 'Unknown error';
        await this.party.storage.put("status", taskData);
        await this.addLogEntry(`Error during analysis: ${error.message || 'Unknown error'}`, 'error');
      }
    }
  }

  // Add a log entry to the task
  private async addLogEntry(message: string, level: 'info' | 'warning' | 'error') {
    const taskData = await this.party.storage.get<TaskStatus>("status");
    
    if (!taskData) {
      console.error('Task data not found when adding log entry');
      return;
    }
    
    if (!taskData.logs) {
      taskData.logs = [];
    }
    
    taskData.logs.push({
      timestamp: new Date().toISOString(),
      message,
      level
    });
    
    await this.party.storage.put("status", taskData);
  }

  // Analyze features
  private async analyzeFeatures(reportData: any): Promise<any> {
    const systemPrompt = `
      You are an AI assistant specialized in analyzing websites for competitive research.
      Your task is to analyze the provided website data and extract information about the product features.
      Focus on identifying:
      1. Key features and capabilities of the product
      2. Unique selling points
      3. Technical specifications
      4. Integrations with other tools
      5. Platform availability (web, mobile, desktop)
      
      Provide a structured analysis with clear sections. Be concise but thorough.
    `;
    
    const userPrompt = `
      Analyze the following website data to identify the product features:
      
      URL: ${reportData.url}
      Title: ${reportData.data.title}
      Description: ${reportData.data.description}
      
      Headings:
      ${reportData.data.headings.h1.map((h: string) => `H1: ${h}`).join('\n')}
      ${reportData.data.headings.h2.map((h: string) => `H2: ${h}`).join('\n')}
      ${reportData.data.headings.h3.map((h: string) => `H3: ${h}`).join('\n')}
      
      Meta Information:
      ${Object.entries(reportData.data.meta.og).map(([key, value]) => `og:${key}: ${value}`).join('\n')}
      ${Object.entries(reportData.data.meta.twitter).map(([key, value]) => `twitter:${key}: ${value}`).join('\n')}
      
      Raw HTML (excerpt):
      ${reportData.data.rawHtml.substring(0, 5000)}
    `;
    
    try {
      const featuresAnalysis = await this.callLLM(systemPrompt, userPrompt);
      
      return {
        analysis: featuresAnalysis,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error('Error analyzing features:', error);
      return {
        error: error.message || 'Unknown error',
        timestamp: new Date().toISOString()
      };
    }
  }

  // Analyze pricing
  private async analyzePricing(reportData: any): Promise<any> {
    const systemPrompt = `
      You are an AI assistant specialized in analyzing websites for competitive research.
      Your task is to analyze the provided website data and extract information about the product pricing.
      Focus on identifying:
      1. Pricing tiers and plans
      2. Free tier or trial availability
      3. Enterprise pricing
      4. Billing frequency options (monthly, annual, etc.)
      5. Discounts for annual billing
      6. Feature limitations per tier
      
      Provide a structured analysis with clear sections. Be concise but thorough.
      If pricing information is not available, state that clearly.
    `;
    
    const userPrompt = `
      Analyze the following website data to identify the product pricing:
      
      URL: ${reportData.url}
      Title: ${reportData.data.title}
      Description: ${reportData.data.description}
      
      Headings:
      ${reportData.data.headings.h1.map((h: string) => `H1: ${h}`).join('\n')}
      ${reportData.data.headings.h2.map((h: string) => `H2: ${h}`).join('\n')}
      ${reportData.data.headings.h3.map((h: string) => `H3: ${h}`).join('\n')}
      
      Links:
      ${reportData.data.links.map((link: any) => `${link.text}: ${link.url}`).join('\n')}
      
      Raw HTML (excerpt):
      ${reportData.data.rawHtml.substring(0, 5000)}
    `;
    
    try {
      const pricingAnalysis = await this.callLLM(systemPrompt, userPrompt);
      
      return {
        analysis: pricingAnalysis,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error('Error analyzing pricing:', error);
      return {
        error: error.message || 'Unknown error',
        timestamp: new Date().toISOString()
      };
    }
  }

  // Analyze customers
  private async analyzeCustomers(reportData: any): Promise<any> {
    const systemPrompt = `
      You are an AI assistant specialized in analyzing websites for competitive research.
      Your task is to analyze the provided website data and extract information about the target customers.
      Focus on identifying:
      1. Target industries or sectors
      2. Company size (SMB, enterprise, etc.)
      3. User roles (developers, marketers, etc.)
      4. Use cases highlighted
      5. Customer testimonials or case studies
      6. Competitive positioning
      
      Provide a structured analysis with clear sections. Be concise but thorough.
      If customer information is not available, state that clearly.
    `;
    
    const userPrompt = `
      Analyze the following website data to identify the target customers:
      
      URL: ${reportData.url}
      Title: ${reportData.data.title}
      Description: ${reportData.data.description}
      
      Headings:
      ${reportData.data.headings.h1.map((h: string) => `H1: ${h}`).join('\n')}
      ${reportData.data.headings.h2.map((h: string) => `H2: ${h}`).join('\n')}
      ${reportData.data.headings.h3.map((h: string) => `H3: ${h}`).join('\n')}
      
      Links:
      ${reportData.data.links.map((link: any) => `${link.text}: ${link.url}`).join('\n')}
      
      Images:
      ${reportData.data.images.map((img: any) => `${img.alt}: ${img.url}`).join('\n')}
      
      Raw HTML (excerpt):
      ${reportData.data.rawHtml.substring(0, 5000)}
    `;
    
    try {
      const customersAnalysis = await this.callLLM(systemPrompt, userPrompt);
      
      return {
        analysis: customersAnalysis,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error('Error analyzing customers:', error);
      return {
        error: error.message || 'Unknown error',
        timestamp: new Date().toISOString()
      };
    }
  }

  // Call the LLM (GPT-4) to generate analysis
  private async callLLM(systemPrompt: string, userPrompt: string, model?: string): Promise<string> {
    try {
      const startTime = Date.now();
      
      // Get API key from environment
      const apiKey = this.party.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OpenAI API key not configured');
      }
      
      // Get model from environment or use default
      const modelToUse = model || this.party.env.OPENAI_MODEL || 'gpt-3.5-turbo';
      
      // Call the LLM using litellm
      const response = await litellm.completion({
        apiKey: apiKey as string,
        model: modelToUse as string,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      });
      
      // Extract the response text
      const responseText = response.choices[0].message.content;
      
      // Log token usage and cost if available
      if (response.usage) {
        const { prompt_tokens: promptTokens, completion_tokens: completionTokens } = response.usage;
        
        const promptPrice = this.party.env.OPENAI_PROMPT_PRICE || '0.03';
        const completionPrice = this.party.env.OPENAI_COMPLETION_PRICE || '0.06';
        const promptCost = (promptTokens / 1000) * parseFloat(promptPrice as string);
        const completionCost = (completionTokens / 1000) * parseFloat(completionPrice as string);
        const totalCost = promptCost + completionCost;
        
        console.log(`[${this.party.id}] LLM call completed in ${Date.now() - startTime}ms`);
        console.log(`[${this.party.id}] Token usage: ${promptTokens + completionTokens} tokens (${promptTokens} prompt, ${completionTokens} completion)`);
        console.log(`[${this.party.id}] Estimated cost: $${totalCost.toFixed(6)} ($${promptCost.toFixed(6)} prompt, $${completionCost.toFixed(6)} completion)`);
        
        await this.addLogEntry(`Token usage: ${promptTokens + completionTokens} tokens (${promptTokens} prompt, ${completionTokens} completion)`, 'info');
        await this.addLogEntry(`Estimated cost: $${totalCost.toFixed(6)} ($${promptCost.toFixed(6)} prompt, $${completionCost.toFixed(6)} completion)`, 'info');
      }
      
      return responseText;
    } catch (error) {
      console.error(`[${this.party.id}] Error calling LLM:`, error);
      await this.addLogEntry(`Error calling LLM: ${error.message}`, 'error');
      throw error;
    }
  }
} 