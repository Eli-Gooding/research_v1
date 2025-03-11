// Test script for LiteLLM integration
const litellm = require('litellm');
const fs = require('fs');

// Read the .dev.vars file manually
const devVars = fs.readFileSync('.dev.vars', 'utf8')
  .split('\n')
  .filter(line => line.trim() !== '')
  .reduce((vars, line) => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0];
      const value = parts.slice(1).join('=').replace(/^"(.*)"$/, '$1'); // Remove quotes if present
      vars[key] = value;
    }
    return vars;
  }, {});

console.log('Environment variables loaded:', Object.keys(devVars));

async function testLiteLLM() {
  try {
    console.log('Testing LiteLLM integration...');
    
    if (!devVars.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not defined in .dev.vars');
    }
    
    const response = await litellm.completion({
      model: devVars.OPENAI_MODEL || 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant.'
        },
        {
          role: 'user',
          content: 'Hello, how are you?'
        }
      ],
      temperature: 0.3,
      max_tokens: 100,
      apiKey: devVars.OPENAI_API_KEY
    });
    
    console.log('LiteLLM response:');
    console.log(JSON.stringify(response, null, 2));
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Error testing LiteLLM:', error);
  }
}

testLiteLLM(); 