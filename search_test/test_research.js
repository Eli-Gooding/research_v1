// Direct test for research function
import { callOpenAI } from './search_workers/utils.js';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Create a simple mock environment
const mockEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  AI_GATEWAY_ENDPOINT: process.env.AI_GATEWAY_ENDPOINT || "https://gateway.ai.cloudflare.com/v1/38786877c1bf24d2d36d539c552a997a/searchworkers-dev/"
};

async function testResearchFunction() {
  console.log('Testing research function...');
  console.log('Using environment:', {
    hasApiKey: !!mockEnv.OPENAI_API_KEY,
    gatewayEndpoint: mockEnv.AI_GATEWAY_ENDPOINT
  });
  
  try {
    const systemPrompt = `
    You are a research assistant gathering information about Apple Inc's overview.
    Provide detailed, factual information based on web search results.
    Include specific details when available.
    Cite your sources with URLs when possible.
    
    Structure your response with clear sections and bullet points when appropriate.
    Focus on the most relevant and recent information available.
    `;
    
    const searchQuery = "Apple Inc overview";
    const modelToUse = 'gpt-4o';
    
    // Prepare the messages array
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: searchQuery }
    ];
    
    // Options for the API call
    const options = {
      max_tokens: 1000,
      temperature: 0.2
    };
    
    console.log(`Making OpenAI API call with model: ${modelToUse}`);
    
    // Call OpenAI with the correct parameter order
    const response = await callOpenAI(mockEnv, modelToUse, messages, options);
    
    console.log('OpenAI response type:', typeof response);
    
    // Handle different response formats
    if (typeof response === 'string') {
      console.log('Response is a string of length:', response.length);
      console.log('Preview:', response.substring(0, 100) + '...');
      
      return {
        success: true,
        content: response
      };
    } else if (response && response.choices && response.choices.length > 0) {
      const content = response.choices[0].message?.content;
      console.log('API call successful!');
      console.log('Generated content length:', content?.length || 0);
      console.log('Total tokens used:', response.usage?.total_tokens || 0);
      
      return {
        success: true,
        content: content || 'No content received'
      };
    } else {
      throw new Error('Invalid response format from OpenAI');
    }
  } catch (error) {
    console.error('Error in research function:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Run the test
testResearchFunction()
  .then(result => {
    console.log('Test completed with result:', result.success ? 'SUCCESS' : 'FAILURE');
    if (!result.success) {
      console.error('Error details:', result.error);
      process.exit(1);
    } else {
      console.log('Content preview:', result.content.substring(0, 100) + '...');
      process.exit(0);
    }
  })
  .catch(error => {
    console.error('Unexpected error in test:', error);
    process.exit(1);
  }); 