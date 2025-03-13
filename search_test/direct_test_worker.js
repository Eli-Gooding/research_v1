// Direct test for the research worker functionality
import { callOpenAI } from './search_workers/utils.js';
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';

// Load environment variables from .env file (for local testing)
dotenv.config();

// Load environment variables from .dev.vars if available
let devVars = {};
try {
  // Use dynamic import for fs since we're using ES modules
  const fs = await import('fs');
  try {
    const devVarsContent = fs.readFileSync('./.dev.vars', 'utf8');
    devVarsContent.split('\n').forEach(line => {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split('=');
        if (key && value) {
          devVars[key.trim()] = value.trim();
        }
      }
    });
    console.log('Loaded variables from .dev.vars');
  } catch (readError) {
    console.log('No .dev.vars file found or error reading it:', readError.message);
  }
} catch (importError) {
  console.log('Error importing fs module:', importError.message);
}

// Global mock storage for R2
const mockR2Storage = {};

// Create our own simplified versions of R2 storage functions
async function mockStoreInR2(key, data) {
  console.log(`[MOCK R2] Storing data at key: ${key}`);
  mockR2Storage[key] = data;
  return { key };
}

async function mockGetFromR2(key) {
  console.log(`[MOCK R2] Retrieving data from key: ${key}`);
  return mockR2Storage[key] || null;
}

// Create a mock environment that mimics the worker environment
const mockEnv = {
  OPENAI_API_KEY: devVars.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  AI_GATEWAY_ENDPOINT: devVars.AI_GATEWAY_ENDPOINT || process.env.AI_GATEWAY_ENDPOINT,
  // Mock R2 storage bindings are not needed since we're using our simplified functions
};

/**
 * Test function that simulates a research worker request
 */
async function testResearchWorker() {
  console.log('Testing research worker functionality...');
  console.log('Using environment:', {
    hasApiKey: !!mockEnv.OPENAI_API_KEY,
    gatewayEndpoint: mockEnv.AI_GATEWAY_ENDPOINT || 'Not set'
  });
  
  // Generate a test job ID
  const jobId = randomUUID();
  console.log(`Generated test job ID: ${jobId}`);
  
  // Test parameters
  const companyName = "Apple Inc";
  const category = "overview";
  const categoryKey = "overview";
  const website = "apple.com";
  
  try {
    // First create the job metadata
    const initialMetadata = {
      jobId,
      companyName,
      website,
      createdAt: new Date().toISOString(),
      categories: {
        overview: {
          status: "pending",
          startedAt: null,
          completedAt: null
        }
      },
      progress: {
        total: 1,
        completed: 0,
        pending: 1,
        error: 0
      }
    };
    
    console.log('Creating initial job metadata...');
    // Use our simplified mock storage
    await mockStoreInR2(`jobs/${jobId}/metadata.json`, JSON.stringify(initialMetadata));
    
    console.log('Starting research process...');
    // Generate the appropriate system prompt
    const systemPrompt = `
      You are a research assistant gathering information about ${companyName}'s ${category}.
      Provide detailed, factual information based on web search results.
      Include specific details when available.
      Cite your sources with URLs when possible.
      
      Structure your response with clear sections and bullet points when appropriate.
      Focus on the most relevant and recent information available.
    `;
    
    // Prepare user prompt
    const userPrompt = `${companyName} ${category}`;
    
    // Prepare the messages array
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
    
    // Set OpenAI API options
    const options = {
      max_tokens: 1000,
      temperature: 0.2,
      store: true // Enable storage of the request and response
    };
    
    console.log(`Making OpenAI API call for ${category}...`);
    
    // Retrieve the metadata
    const metadataStr = await mockGetFromR2(`jobs/${jobId}/metadata.json`);
    console.log('Retrieved metadata string:', metadataStr);
    
    // Parse the metadata
    let metadata = JSON.parse(metadataStr);
    console.log('Parsed metadata:', metadata);
    
    // Mark category as processing in metadata
    metadata.categories[categoryKey].status = "processing";
    metadata.categories[categoryKey].startedAt = new Date().toISOString();
    await mockStoreInR2(`jobs/${jobId}/metadata.json`, JSON.stringify(metadata));
    
    // Call OpenAI
    const response = await callOpenAI(mockEnv, 'gpt-4o', messages, options);
    
    // Process the response
    let result = {
      success: true,
      content: '',
      timestamp: new Date().toISOString()
    };
    
    if (typeof response === 'string') {
      result.content = response;
    } else if (response && response.choices && response.choices.length > 0) {
      result.content = response.choices[0].message?.content || '';
      result.tokenUsage = response.usage;
    } else {
      throw new Error('Invalid response format from OpenAI');
    }
    
    console.log('Research completed successfully!');
    console.log('Content length:', result.content.length);
    console.log('Content preview:', result.content.substring(0, 100) + '...');
    
    // Store the result
    console.log(`Storing research result for ${categoryKey}...`);
    await mockStoreInR2(`jobs/${jobId}/categories/${categoryKey}.json`, JSON.stringify(result));
    
    // Update job metadata
    const updatedMetadataStr = await mockGetFromR2(`jobs/${jobId}/metadata.json`);
    console.log('Retrieved updated metadata string:', updatedMetadataStr);
    
    // Parse the updated metadata
    let updatedMetadata = JSON.parse(updatedMetadataStr);
    console.log('Parsed updated metadata:', updatedMetadata);
    
    // Update the status
    updatedMetadata.categories[categoryKey].status = "completed";
    updatedMetadata.categories[categoryKey].completedAt = new Date().toISOString();
    updatedMetadata.progress.completed += 1;
    updatedMetadata.progress.pending -= 1;
    
    await mockStoreInR2(`jobs/${jobId}/metadata.json`, JSON.stringify(updatedMetadata));
    
    console.log('Job metadata updated successfully!');
    console.log('Final job metadata:', updatedMetadata);
    
    return {
      success: true,
      jobId,
      result
    };
  } catch (error) {
    console.error('Error in research worker test:', error);
    
    // Update job metadata with error
    try {
      const metadataStr = await mockGetFromR2(`jobs/${jobId}/metadata.json`);
      console.log('Retrieved metadata string (error case):', metadataStr);
      
      const metadata = JSON.parse(metadataStr);
      console.log('Parsed metadata (error case):', metadata);
      
      metadata.categories[categoryKey].status = "error";
      metadata.categories[categoryKey].error = error.message;
      metadata.progress.error += 1;
      metadata.progress.pending -= 1;
      
      await mockStoreInR2(`jobs/${jobId}/metadata.json`, JSON.stringify(metadata));
      console.log('Updated job metadata with error status');
    } catch (metadataError) {
      console.error('Failed to update job metadata with error:', metadataError);
    }
    
    return {
      success: false,
      jobId,
      error: error.message
    };
  }
}

// Run the test
testResearchWorker()
  .then(result => {
    console.log('Test completed with result:', result.success ? 'SUCCESS' : 'FAILURE');
    if (!result.success) {
      console.error('Error details:', result.error);
      process.exit(1);
    } else {
      console.log('Job ID:', result.jobId);
      process.exit(0);
    }
  })
  .catch(error => {
    console.error('Unexpected error in test:', error);
    process.exit(1);
  }); 