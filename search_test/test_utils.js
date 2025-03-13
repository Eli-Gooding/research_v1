// Test script to verify utils.js imports
import { callOpenAI, storeInR2, getFromR2 } from './search_workers/utils.js';

// Log the available functions
console.log('Imported functions:');
console.log('- callOpenAI:', typeof callOpenAI);
console.log('- storeInR2:', typeof storeInR2);
console.log('- getFromR2:', typeof getFromR2);

// Create a mock environment
const mockEnv = {
  OPENAI_API_KEY: 'mock-key',
  AI_GATEWAY_ENDPOINT: 'https://example.com',
  STORAGE_BUCKET: {
    get: async () => null,
    put: async () => ({ success: true })
  }
};

// Test the callOpenAI function (but don't actually send a request)
try {
  console.log('Testing callOpenAI import...');
  // Just verify the function exists without calling it
  console.log('callOpenAI is a function:', typeof callOpenAI === 'function');
} catch (error) {
  console.error('Error testing callOpenAI:', error);
}

// Test the storage functions
try {
  console.log('Testing storage functions...');
  console.log('storeInR2 is a function:', typeof storeInR2 === 'function');
  console.log('getFromR2 is a function:', typeof getFromR2 === 'function');
} catch (error) {
  console.error('Error testing storage functions:', error);
} 