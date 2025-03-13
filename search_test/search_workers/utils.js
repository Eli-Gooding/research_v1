/**
 * Utility Functions for Search Agent Workers
 * 
 * This file contains helper functions used across multiple workers:
 * 1. OpenAI API integration
 * 2. R2 storage operations
 * 3. Error handling
 * 4. Data processing
 */

import OpenAI from 'openai';

// Add a helper function for consistent logging
function logWithTimestamp(message, data = null) {
  const timestamp = new Date().toISOString();
  const logPrefix = `[UTILS ${timestamp}]`;
  
  if (data) {
    console.log(`${logPrefix} ${message}`, data);
  } else {
    console.log(`${logPrefix} ${message}`);
  }
}

/**
 * Call OpenAI API with tracking through AI Gateway
 * @param {Object} env - Environment variables
 * @param {string} model - OpenAI model ID
 * @param {Object[]} messages - Array of message objects
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The API response
 */
export async function callOpenAI(env, model, messages, options = {}) {
  logWithTimestamp(`Starting OpenAI API call for model: ${model}`);
  
  try {
    // Check for required environment variables
    if (!env.OPENAI_API_KEY) {
      logWithTimestamp('ERROR: Missing required API key: OPENAI_API_KEY');
      throw new Error('Missing required API key: OPENAI_API_KEY');
    }

    if (!env.AI_GATEWAY_ENDPOINT) {
      logWithTimestamp('WARNING: AI_GATEWAY_ENDPOINT not set, OpenAI calls may fail');
    }

    // Log all environment variables for debugging
    logWithTimestamp('Environment variables:', {
      OPENAI_API_KEY: env.OPENAI_API_KEY ? 'Set (first 5 chars: ' + env.OPENAI_API_KEY.substring(0, 5) + ')' : 'Not set',
      AI_GATEWAY_ENDPOINT: env.AI_GATEWAY_ENDPOINT || 'Not set',
      STORAGE_BUCKET: env.STORAGE_BUCKET ? 'Set' : 'Not set',
      RESEARCH_BUCKET: env.RESEARCH_BUCKET ? 'Set' : 'Not set'
    });

    // Set default options
    const defaultOptions = {
      temperature: 0.2,
      max_tokens: 4000
    };

    // Merge default options with provided options
    const finalOptions = {
      ...defaultOptions,
      ...options
    };

    logWithTimestamp(`Calling OpenAI model: ${model}`, {
      messageCount: messages.length,
      temperature: finalOptions.temperature,
      max_tokens: finalOptions.max_tokens,
      baseURL: env.AI_GATEWAY_ENDPOINT || 'Not set'
    });

    // Log message content for debugging (truncated for privacy)
    const truncatedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : '')
    }));
    logWithTimestamp('Message content (truncated):', truncatedMessages);

    // Initialize OpenAI client with AI Gateway as the base URL
    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.AI_GATEWAY_ENDPOINT
    });

    logWithTimestamp('OpenAI client initialized, sending request...');

    // Call OpenAI through AI Gateway
    const response = await openai.chat.completions.create({
      model,
      messages,
      temperature: finalOptions.temperature,
      max_tokens: finalOptions.max_tokens
    });

    logWithTimestamp('Received response from OpenAI API', {
      responseType: typeof response,
      hasChoices: !!response.choices,
      choicesLength: response.choices?.length,
      usage: response.usage
    });
    
    // If we get a string back, try to parse it as JSON
    if (typeof response === 'string') {
      logWithTimestamp('Response is a string, attempting to parse as JSON');
      try {
        const parsedResponse = JSON.parse(response);
        logWithTimestamp('Successfully parsed string response as JSON');
        return parsedResponse;
      } catch (err) {
        logWithTimestamp('Failed to parse response as JSON:', err);
        // Return a structured response with the string content
        return {
          choices: [
            {
              message: {
                content: response,
                role: 'assistant'
              }
            }
          ],
          usage: { total_tokens: 0 }
        };
      }
    }
    
    // Log a sample of the response content (truncated for privacy)
    if (response.choices && response.choices[0] && response.choices[0].message) {
      const content = response.choices[0].message.content;
      logWithTimestamp('Response content sample:', {
        content: content.substring(0, 100) + (content.length > 100 ? '...' : '')
      });
    }
    
    return response;
  } catch (error) {
    logWithTimestamp('ERROR in OpenAI API call:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    
    // Log more details for specific error types
    if (error.response) {
      logWithTimestamp('OpenAI API error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    
    throw error;
  }
}

/**
 * Store data in R2 bucket
 * @param {Object} env - Environment variables
 * @param {string} key - R2 object key
 * @param {string|Buffer|ReadableStream} data - Data to store
 * @returns {Promise<Object>} Storage result
 */
export async function storeInR2(env, key, data) {
  logWithTimestamp(`Starting R2 storage operation for key: ${key}`);
  
  try {
    // Get R2 bucket from environment
    const bucket = env.STORAGE_BUCKET;

    if (!bucket) {
      logWithTimestamp('ERROR: R2 storage bucket not available in environment');
      throw new Error('Storage bucket not configured');
    }
    
    // Log data size for debugging
    let dataSize = 'unknown';
    if (typeof data === 'string') {
      dataSize = `${data.length} characters`;
    } else if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
      dataSize = `${data.byteLength} bytes`;
    }
    logWithTimestamp(`Data size for R2 storage: ${dataSize}`);
    
    // Convert data to buffer if it's a string
    const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    
    // Determine content type
    let contentType = 'application/octet-stream';
    if (typeof data === 'string') {
      if (key.endsWith('.json')) {
        contentType = 'application/json';
      } else if (key.endsWith('.txt')) {
        contentType = 'text/plain';
      }
    }
    
    logWithTimestamp(`Storing data in R2: ${key}`, {
      contentType,
      dataType: typeof data,
      bucketAvailable: !!bucket
    });
    
    // Store data in R2
    await bucket.put(key, buffer, {
      httpMetadata: {
        contentType
      }
    });
    
    logWithTimestamp(`Successfully stored data in R2: ${key}`);
    
    return {
      success: true,
      key
    };
  } catch (error) {
    logWithTimestamp(`ERROR storing data in R2: ${key}`, {
      error: error.message,
      stack: error.stack
    });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get data from R2 bucket
 * @param {Object} env - Environment variables
 * @param {string} key - R2 object key
 * @returns {Promise<string|null>} Retrieved data as string or null if not found
 */
export async function getFromR2(env, key) {
  logWithTimestamp(`Starting R2 retrieval operation for key: ${key}`);
  
  try {
    // Get R2 bucket from environment
    const bucket = env.STORAGE_BUCKET;
    
    if (!bucket) {
      logWithTimestamp('ERROR: R2 storage bucket not available in environment');
      return null;
    }
    
    logWithTimestamp(`Retrieving data from R2: ${key}`, {
      bucketAvailable: !!bucket
    });
    
    // Get object from R2
    const object = await bucket.get(key);
    
    // If object doesn't exist, return null
    if (!object) {
      logWithTimestamp(`Object not found in R2: ${key}`);
      return null;
    }
    
    logWithTimestamp(`Successfully retrieved object from R2: ${key}`, {
      size: object.size,
      etag: object.etag,
      uploaded: object.uploaded
    });
    
    // Return object data as string
    const text = await object.text();
    logWithTimestamp(`Converted R2 object to text, length: ${text.length} characters`);
    return text;
  } catch (error) {
    logWithTimestamp(`ERROR retrieving data from R2: ${key}`, {
      error: error.message,
      stack: error.stack
    });
    return null;
  }
}

/**
 * Parse company name from query
 * @param {string} query - User query
 * @returns {string|null} Extracted company name or null
 */
export function extractCompanyName(query) {
  // Simple regex to find company names (often in quotes or followed by specific words)
  const regexPatterns = [
    /"([^"]+)"/,                          // Anything in quotes
    /about\s+([A-Z][A-Za-z0-9\s]+)/,      // Anything after "about" starting with capital letter
    /research\s+on\s+([A-Z][A-Za-z0-9\s]+)/, // Anything after "research on" starting with capital letter
    /([A-Z][A-Za-z0-9]+(?:\.[A-Za-z0-9]+)?)\s+company/ // Company name followed by "company"
  ];
  
  for (const regex of regexPatterns) {
    const match = query.match(regex);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  // If no match found with regex, try to extract capitalized words
  const words = query.split(/\s+/);
  for (const word of words) {
    // Check if word starts with capital letter and is not a common word
    if (
      word.length > 1 && 
      /^[A-Z]/.test(word) && 
      !['I', 'A', 'The', 'What', 'Who', 'Where', 'When', 'Why', 'How'].includes(word)
    ) {
      return word;
    }
  }
  
  return null;
}

/**
 * Log structured event for analytics
 * @param {Object} env - Environment variables
 * @param {string} eventType - Type of event
 * @param {Object} eventData - Event data
 */
export async function logEvent(env, eventType, eventData) {
  try {
    // Check if logging is enabled
    if (!env.LOG_ENDPOINT) {
      return;
    }
    
    // Add timestamp
    const event = {
      type: eventType,
      timestamp: new Date().toISOString(),
      ...eventData
    };
    
    // Send event to logging endpoint
    await fetch(env.LOG_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.LOG_API_KEY || 'missing-key'}`
      },
      body: JSON.stringify(event)
    });
  } catch (error) {
    console.error('Error logging event:', error);
    // Fail silently - logging errors shouldn't affect the main workflow
  }
}

/**
 * Build system prompt for AI models
 * @param {string} role - Role description for the AI
 * @param {string} task - Task description
 * @param {string} format - Output format instructions
 * @returns {string} Formatted system prompt
 */
export function buildSystemPrompt(role, task, format) {
  return `${role}
  
${task}

${format}`;
}

/**
 * Extract domain from URL
 * @param {string} url - URL to extract domain from
 * @returns {string|null} Domain or null if invalid URL
 */
export function extractDomain(url) {
  try {
    if (!url) return null;
    
    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    const domain = new URL(url).hostname;
    return domain.startsWith('www.') ? domain.substring(4) : domain;
  } catch (error) {
    return null;
  }
} 