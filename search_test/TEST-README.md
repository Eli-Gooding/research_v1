# Search Worker Testing

This directory contains test scripts to verify the functionality of the search workers without relying on PartyKit integration.

## Configuration

Tests use environment variables from the following sources (in order of precedence):
1. `.dev.vars` file
2. `.env` file
3. Environment variables set in the shell

Required environment variables:
- `OPENAI_API_KEY`: API key for OpenAI
- `AI_GATEWAY_ENDPOINT`: Endpoint for the AI Gateway, including the `/openai` path

## Available Tests

### 1. Direct OpenAI API Test (`test_research.js`)

This test verifies that the OpenAI API call works correctly through the AI Gateway.

```bash
node test_research.js
```

This will:
- Initialize the OpenAI client with the AI Gateway endpoint
- Make a sample API call to generate an overview of Apple Inc.
- Display the result of the API call

### 2. Single Category Research Test (`direct_test_worker.js`)

This test verifies the core research worker functionality for a single category.

```bash
node direct_test_worker.js
```

This will:
- Create a mock R2 storage environment
- Generate a test job ID
- Create initial job metadata
- Make an OpenAI API call for the "overview" category
- Store the result in the mock R2 storage
- Update the job metadata

### 3. Multi-Category Research Test (`test_all_categories.js`)

This test simulates running research on all five categories.

```bash
node test_all_categories.js
```

This will:
- Create a mock R2 storage environment
- Generate a test job ID
- Create initial job metadata for all five categories
- Process each category sequentially:
  - Update metadata to mark the category as processing
  - Make an OpenAI API call
  - Store the result
  - Update metadata to mark the category as completed
- Display the final job metadata and status summary

## Troubleshooting

If you encounter errors, check the following:

1. **API Key Issues**: Make sure your OpenAI API key is valid and properly set
2. **AI Gateway Endpoint**: Ensure the endpoint includes the `/openai` path at the end
3. **OpenAI Model Availability**: Verify that you have access to the model specified in the tests (default: gpt-4o)
4. **Rate Limiting**: If you hit rate limits, add a delay between category processing or use a different API key

## Adding New Tests

When adding new tests, follow these patterns:

1. Use the mock R2 storage functions from `direct_test_worker.js`
2. Call the OpenAI API using the `callOpenAI` function from `utils.js`
3. Follow the job metadata structure with categories, progress tracking, and timestamps 