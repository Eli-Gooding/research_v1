# Web Search Agent (JavaScript Version)

A JavaScript-based search agent that uses OpenAI's web search feature to handle both simple queries and detailed company research.

## Features

- **Query Classification**: Automatically determines if a query requires a simple answer or detailed research
- **Simple Answers**: Provides concise, accurate answers to straightforward questions
- **Company Research**: Conducts detailed research on companies, including:
  - Finding the official website
  - Researching products and services
  - Identifying key features
  - Gathering pricing information
  - Analyzing market positioning
- **Comprehensive Reports**: Generates well-structured research reports with proper citations

## Requirements

- Node.js 14+
- OpenAI API key with access to GPT-4o models
- Required npm packages:
  - openai
  - dotenv
  - commander (for CLI)

## Installation

1. Clone this repository:
   ```
   git clone <repository-url>
   cd search_test
   ```

2. Install the required dependencies:
   ```
   npm install openai dotenv commander
   ```

3. Create a `.env` file with your OpenAI API key:
   ```
   OPENAI_API_KEY=your-api-key
   ```

4. Make the CLI executable (optional):
   ```
   chmod +x search_cli.js
   ```

## Usage

### Command Line Interface

The search agent can be used via the command-line interface:

```
node search_cli.js "Your query here"
```

#### Options

- `--model <MODEL>`: Specify the OpenAI model to use (default: gpt-4o)
- `--json`: Output results in JSON format
- `--save <FILENAME>`: Save results to the specified file

### Examples

#### Simple Query

```
node search_cli.js "What is the capital of France?"
```

#### Company Research Query

```
node search_cli.js "Tell me about Stripe's products, pricing, and market position."
```

### Using as a Library

You can also use the SearchAgent class directly in your JavaScript code:

```javascript
const SearchAgent = require('./search_agent');

// Async function to use the agent
async function runSearch() {
  // Initialize the agent
  const agent = new SearchAgent('gpt-4o');
  
  // Process a simple query
  const simpleResult = await agent.processQuery('What is the capital of France?');
  console.log(simpleResult.response);
  
  // Process a research query
  const researchResult = await agent.processQuery("Tell me about Stripe's products, pricing, and market position.");
  console.log(researchResult.research_report);
}

runSearch().catch(console.error);
```

## How It Works

1. **Query Classification**: The agent first determines if the query requires a simple answer or detailed research.
2. **Simple Queries**: For simple queries, the agent uses the web search-enabled model to provide a direct answer.
3. **Research Queries**: For research queries, the agent:
   - Extracts the company name
   - Finds the official website
   - Researches specific categories (customers, products, features, pricing, market positioning)
   - Compiles a comprehensive research report

## Limitations

- Requires an OpenAI API key with access to GPT-4o models
- Web search results may not always be up-to-date
- Research quality depends on the availability of information online
- API usage incurs costs based on OpenAI's pricing

## License

[MIT License](LICENSE) 