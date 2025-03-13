#!/usr/bin/env node

// Import required modules
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const SearchAgent = require('./search_agent');

/**
 * Main function to run the CLI
 */
async function main() {
  // Set up command-line arguments
  program
    .name('search-cli')
    .description('Search Agent CLI - Process queries with web search')
    .argument('[query...]', 'The query to process')
    .option('--model <model>', 'The OpenAI model to use', 'gpt-4o')
    .option('--json', 'Output results in JSON format')
    .option('--save <filename>', 'Save results to the specified file')
    .parse(process.argv);

  // Get options and arguments
  const options = program.opts();
  const queryArgs = program.args;

  // Check if OPENAI_API_KEY is set
  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY environment variable is not set.');
    console.error("Please set it with: export OPENAI_API_KEY='your-api-key'");
    return 1;
  }

  // Initialize the search agent
  const agent = new SearchAgent(options.model);

  // Get the query from command line arguments or prompt the user
  let query;
  if (queryArgs.length > 0) {
    query = queryArgs.join(' ');
  } else {
    // Simple readline for input
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    query = await new Promise(resolve => {
      readline.question('Enter your query: ', answer => {
        readline.close();
        resolve(answer);
      });
    });
  }

  console.log(`\nProcessing query: ${query}\n`);

  try {
    // Process the query
    const result = await agent.processQuery(query);

    // Output the results
    if (options.json) {
      // Output in JSON format
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Output in human-readable format
      if (result.query_type === 'simple') {
        console.log('Query Type: Simple');
        console.log('-'.repeat(80));
        console.log(result.response);
        console.log('-'.repeat(80));
        console.log(`Tokens used: ${result.tokens_used}`);
      } else {
        console.log(`Query Type: Research on ${result.company_name}`);
        console.log(`Official Website: ${result.official_website}`);
        console.log('-'.repeat(80));
        console.log(result.research_report);
        console.log('-'.repeat(80));
      }
    }

    // Save results to file if requested
    if (options.save) {
      if (options.json) {
        fs.writeFileSync(options.save, JSON.stringify(result, null, 2));
      } else {
        let content = '';
        if (result.query_type === 'simple') {
          content += `Query: ${query}\n`;
          content += `Query Type: Simple\n`;
          content += `${'-'.repeat(80)}\n`;
          content += `${result.response}\n`;
        } else {
          content += `Query: ${query}\n`;
          content += `Query Type: Research on ${result.company_name}\n`;
          content += `Official Website: ${result.official_website}\n`;
          content += `${'-'.repeat(80)}\n`;
          content += `${result.research_report}\n`;
        }
        fs.writeFileSync(options.save, content);
      }

      console.log(`\nResults saved to ${options.save}`);
    }

    return 0;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

// Run the main function
main()
  .then(exitCode => process.exit(exitCode))
  .catch(error => {
    console.error(`Unhandled error: ${error.message}`);
    process.exit(1);
  }); 