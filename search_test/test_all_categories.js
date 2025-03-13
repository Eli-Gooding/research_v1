// Test research worker functionality for all research categories
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
 * Test function that simulates a research worker request for multiple categories
 */
async function testMultiCategoryResearch() {
  console.log('Testing research worker functionality for multiple categories...');
  console.log('Using environment:', {
    hasApiKey: !!mockEnv.OPENAI_API_KEY,
    gatewayEndpoint: mockEnv.AI_GATEWAY_ENDPOINT || 'Not set'
  });
  
  // Test parameters
  const jobId = randomUUID();
  const companyName = "Apple Inc";
  const website = "apple.com";
  
  // Define all categories to test
  const categories = [
    { key: "overview", displayName: "Company Overview" },
    { key: "products", displayName: "Products and Services" },
    { key: "customers", displayName: "Target Customers" },
    { key: "competitors", displayName: "Key Competitors" },
    { key: "pricing", displayName: "Pricing Strategy" }
  ];
  
  console.log(`Generated test job ID: ${jobId}`);
  console.log(`Testing categories: ${categories.map(c => c.key).join(', ')}`);
  
  try {
    // First create the job metadata
    const initialMetadata = {
      jobId,
      companyName,
      website,
      createdAt: new Date().toISOString(),
      categories: {},
      progress: {
        total: categories.length,
        completed: 0,
        pending: categories.length,
        error: 0
      }
    };
    
    // Initialize categories in metadata
    categories.forEach(category => {
      initialMetadata.categories[category.key] = {
        status: "pending",
        startedAt: null,
        completedAt: null
      };
    });
    
    // Store initial metadata
    console.log('Creating initial job metadata...');
    await mockStoreInR2(`jobs/${jobId}/metadata.json`, JSON.stringify(initialMetadata));
    
    // Process each category sequentially
    for (const category of categories) {
      console.log(`\n--- Processing category: ${category.displayName} (${category.key}) ---`);
      
      try {
        // Update metadata to mark this category as processing
        let metadata = JSON.parse(await mockGetFromR2(`jobs/${jobId}/metadata.json`));
        metadata.categories[category.key].status = "processing";
        metadata.categories[category.key].startedAt = new Date().toISOString();
        await mockStoreInR2(`jobs/${jobId}/metadata.json`, JSON.stringify(metadata));
        
        // Generate the system prompt for this category
        const systemPrompt = `
          You are a research assistant gathering information about ${companyName}'s ${category.displayName.toLowerCase()}.
          Provide detailed, factual information based on web search results.
          Include specific details when available.
          Cite your sources with URLs when possible.
          
          Structure your response with clear sections and bullet points when appropriate.
          Focus on the most relevant and recent information available.
        `;
        
        // Prepare user prompt
        const userPrompt = `${companyName} ${category.displayName.toLowerCase()}`;
        
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
        
        console.log(`Making OpenAI API call for ${category.key}...`);
        
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
        
        console.log(`${category.key} research completed successfully!`);
        console.log('Content length:', result.content.length);
        console.log('Content preview:', result.content.substring(0, 100) + '...');
        
        // Store the result
        await mockStoreInR2(`jobs/${jobId}/categories/${category.key}.json`, JSON.stringify(result));
        
        // Update metadata to mark this category as completed
        metadata = JSON.parse(await mockGetFromR2(`jobs/${jobId}/metadata.json`));
        metadata.categories[category.key].status = "completed";
        metadata.categories[category.key].completedAt = new Date().toISOString();
        metadata.progress.completed += 1;
        metadata.progress.pending -= 1;
        await mockStoreInR2(`jobs/${jobId}/metadata.json`, JSON.stringify(metadata));
        
        console.log(`Updated job metadata for ${category.key}, status: completed`);
      } catch (categoryError) {
        console.error(`Error processing category ${category.key}:`, categoryError);
        
        // Update metadata to mark this category as error
        const metadata = JSON.parse(await mockGetFromR2(`jobs/${jobId}/metadata.json`));
        metadata.categories[category.key].status = "error";
        metadata.categories[category.key].error = categoryError.message;
        metadata.progress.error += 1;
        metadata.progress.pending -= 1;
        await mockStoreInR2(`jobs/${jobId}/metadata.json`, JSON.stringify(metadata));
        
        console.log(`Updated job metadata for ${category.key}, status: error`);
      }
    }
    
    // Get final metadata
    const finalMetadata = JSON.parse(await mockGetFromR2(`jobs/${jobId}/metadata.json`));
    console.log('\nFinal job metadata:', finalMetadata);
    
    // Check if all categories are complete
    const allCompleted = categories.every(
      category => finalMetadata.categories[category.key].status === "completed"
    );
    
    if (allCompleted) {
      console.log('All categories completed successfully!');
    } else {
      console.log('Not all categories completed successfully. Check the logs for errors.');
    }
    
    return {
      success: allCompleted,
      jobId,
      metadata: finalMetadata
    };
  } catch (error) {
    console.error('Error in multi-category test:', error);
    return {
      success: false,
      jobId,
      error: error.message
    };
  }
}

// Run the test
testMultiCategoryResearch()
  .then(result => {
    console.log('\nTest completed with result:', result.success ? 'SUCCESS' : 'FAILURE');
    console.log('Job status summary:');
    
    if (result.metadata) {
      const metadata = result.metadata;
      console.log(`- Completed: ${metadata.progress.completed} / ${metadata.progress.total}`);
      console.log(`- Errors: ${metadata.progress.error}`);
      console.log(`- Pending: ${metadata.progress.pending}`);
      
      // List the status of each category
      console.log('\nCategory statuses:');
      Object.keys(metadata.categories).forEach(key => {
        console.log(`- ${key}: ${metadata.categories[key].status}`);
      });
    }
    
    if (!result.success && result.error) {
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