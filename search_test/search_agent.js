// Import required modules
require('dotenv').config();
const OpenAI = require('openai');

// Initialize the OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * A search agent that can handle both simple answer queries and detailed research queries.
 * Uses OpenAI's web search feature to gather information.
 */
class SearchAgent {
  /**
   * Initialize the search agent.
   * @param {string} model - The OpenAI model to use for processing queries
   */
  constructor(model = 'gpt-4o') {
    this.model = model;
    this.client = client;
  }

  /**
   * Process a user query and determine whether it requires a simple answer or a detailed research.
   * @param {string} userQuery - The user's query string
   * @returns {Promise<object>} A dictionary containing the response and metadata
   */
  async processQuery(userQuery) {
    // First, determine if this is a simple query or needs research
    const queryType = await this._determineQueryType(userQuery);
    
    if (queryType === 'simple') {
      return await this._handleSimpleQuery(userQuery);
    } else {
      return await this._handleResearchQuery(userQuery);
    }
  }

  /**
   * Determine if the query requires a simple answer or detailed research.
   * @param {string} query - The user's query
   * @returns {Promise<string>} "simple" or "research"
   * @private
   */
  async _determineQueryType(query) {
    // Use the model to determine if this is a simple query or needs research
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
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query }
        ],
        max_tokens: 10
      });
      
      const result = response.choices[0].message.content.trim().toLowerCase();
      return result.includes('research') ? 'research' : 'simple';
    } catch (e) {
      console.error(`Error determining query type: ${e.message}`);
      // Default to simple if there's an error
      return 'simple';
    }
  }

  /**
   * Handle a simple query using web search.
   * @param {string} query - The user's query
   * @returns {Promise<object>} A dictionary with the response
   * @private
   */
  async _handleSimpleQuery(query) {
    // Use the web search feature to get a simple answer
    let modelToUse;
    let response;
    
    try {
      // First try with the search-preview model
      modelToUse = `${this.model}-search-preview`;
      response = await this.client.chat.completions.create({
        model: modelToUse,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that provides accurate, concise answers using web search.' },
          { role: 'user', content: query }
        ]
      });
    } catch (e) {
      console.error(`Error with search-preview model: ${e.message}`);
      // Fallback to regular model if search-preview is not available
      modelToUse = this.model;
      response = await this.client.chat.completions.create({
        model: modelToUse,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that provides accurate, concise answers.' },
          { role: 'user', content: query }
        ]
      });
    }
    
    return {
      query_type: 'simple',
      original_query: query,
      response: response.choices[0].message.content,
      tokens_used: response.usage.total_tokens,
      model_used: modelToUse
    };
  }

  /**
   * Handle a detailed research query about a company.
   * @param {string} query - The user's query
   * @returns {Promise<object>} A dictionary with the research results
   * @private
   */
  async _handleResearchQuery(query) {
    // Extract the company name from the query
    const companyName = await this._extractCompanyName(query);
    
    if (!companyName) {
      // If no company name was found, treat it as a simple query
      return await this._handleSimpleQuery(query);
    }
    
    // Step 1: Find the official website
    const officialWebsite = await this._findOfficialWebsite(companyName);
    
    // Step 2: Research the company's products, features, pricing, and market positioning
    const researchResults = await this._researchCompany(companyName, officialWebsite);
    
    // Step 3: Compile the final research report
    const finalReport = await this._compileResearchReport(companyName, researchResults);
    
    return {
      query_type: 'research',
      original_query: query,
      company_name: companyName,
      official_website: officialWebsite,
      research_report: finalReport,
      research_data: researchResults.results,
      models_used: researchResults.models_used
    };
  }

  /**
   * Extract the company name from the query.
   * @param {string} query - The user's query
   * @returns {Promise<string|null>} The extracted company name or null if not found
   * @private
   */
  async _extractCompanyName(query) {
    const systemPrompt = `
    Extract the company name from the following query. 
    If there is no specific company mentioned, respond with "None".
    Respond with ONLY the company name or "None".
    `;
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query }
        ],
        max_tokens: 50
      });
      
      const result = response.choices[0].message.content.trim();
      return result.toLowerCase() === 'none' ? null : result;
    } catch (e) {
      console.error(`Error extracting company name: ${e.message}`);
      return null;
    }
  }

  /**
   * Find the official website for the company.
   * @param {string} companyName - The name of the company
   * @returns {Promise<string>} The URL of the official website
   * @private
   */
  async _findOfficialWebsite(companyName) {
    const searchQuery = `${companyName} official website`;
    let modelToUse;
    let response;
    
    try {
      // Try with search-preview model
      modelToUse = `${this.model}-search-preview`;
      response = await this.client.chat.completions.create({
        model: modelToUse,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that finds official company websites. Respond with ONLY the URL of the official website.' },
          { role: 'user', content: searchQuery }
        ],
        max_tokens: 100
      });
    } catch (e) {
      console.error(`Error with search-preview model: ${e.message}`);
      // Fallback to regular model
      modelToUse = this.model;
      response = await this.client.chat.completions.create({
        model: modelToUse,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that finds official company websites. Respond with ONLY the URL of the official website.' },
          { role: 'user', content: searchQuery }
        ],
        max_tokens: 100
      });
    }
    
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
  }

  /**
   * Research the company's products, features, pricing, and market positioning.
   * @param {string} companyName - The name of the company
   * @param {string} website - The company's official website
   * @returns {Promise<object>} A dictionary with the research results
   * @private
   */
  async _researchCompany(companyName, website) {
    // Research categories
    const categories = [
      'customers and target audience',
      'products and services',
      'features and capabilities',
      'pricing information',
      'market positioning and competitors'
    ];
    
    const results = {};
    const modelsUsed = {};
    
    for (const category of categories) {
      let searchQuery = `${companyName} ${category}`;
      
      // Use the website in the query if available
      if (website && website.includes('http')) {
        const domain = website.split('//')[1].split('/')[0];
        searchQuery += ` site:${domain}`;
      }
      
      const systemPrompt = `
      You are a research assistant gathering information about ${companyName}'s ${category}.
      Provide detailed, factual information based on web search results.
      Include specific details when available.
      Cite your sources with URLs when possible.
      `;
      
      let modelToUse;
      let response;
      
      try {
        // Try with search-preview model
        modelToUse = `${this.model}-search-preview`;
        response = await this.client.chat.completions.create({
          model: modelToUse,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: searchQuery }
          ],
          max_tokens: 1000
        });
      } catch (e) {
        console.error(`Error with search-preview model for ${category}: ${e.message}`);
        // Fallback to regular model
        modelToUse = this.model;
        response = await this.client.chat.completions.create({
          model: modelToUse,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: searchQuery }
          ],
          max_tokens: 1000
        });
      }
      
      results[category] = response.choices[0].message.content;
      modelsUsed[category] = modelToUse;
    }
    
    return {
      results: results,
      models_used: modelsUsed
    };
  }

  /**
   * Compile the final research report based on the gathered information.
   * @param {string} companyName - The name of the company
   * @param {object} researchResults - The research results for each category
   * @returns {Promise<string>} The compiled research report
   * @private
   */
  async _compileResearchReport(companyName, researchResults) {
    // Combine all research results into a single context
    const combinedResearch = Object.entries(researchResults.results)
      .map(([category, results]) => `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n${results}`)
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
    `;
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: combinedResearch }
        ],
        max_tokens: 2000
      });
      
      return response.choices[0].message.content;
    } catch (e) {
      console.error(`Error compiling research report: ${e.message}`);
      return 'Error generating research report. Please try again.';
    }
  }
}

module.exports = SearchAgent;

// Example usage
if (require.main === module) {
  const runExamples = async () => {
    const agent = new SearchAgent();
    
    // Example simple query
    console.log('Running simple query example...');
    const simpleResult = await agent.processQuery('What is the capital of France?');
    console.log(`Simple Query Result: ${simpleResult.response}\n`);
    
    // Example research query
    console.log('Running research query example...');
    const researchResult = await agent.processQuery("Tell me about Stripe's products, pricing, and market position.");
    console.log(`Research Query Result for ${researchResult.company_name}:\n${researchResult.research_report}`);
  };
  
  runExamples().catch(console.error);
} 