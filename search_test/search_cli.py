#!/usr/bin/env python3
import os
import argparse
import json
from dotenv import load_dotenv
from search_agent import SearchAgent

# Load environment variables from .env file
load_dotenv()

def main():
    """
    Command-line interface for the SearchAgent.
    """
    parser = argparse.ArgumentParser(description="Search Agent CLI - Process queries with web search")
    parser.add_argument("query", nargs="*", help="The query to process")
    parser.add_argument("--model", default="gpt-4o", help="The OpenAI model to use (default: gpt-4o)")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format")
    parser.add_argument("--save", help="Save results to the specified file")
    
    args = parser.parse_args()
    
    # Check if OPENAI_API_KEY is set
    if not os.environ.get("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY environment variable is not set.")
        print("Please set it with: export OPENAI_API_KEY='your-api-key'")
        return 1
    
    # Initialize the search agent
    agent = SearchAgent(model=args.model)
    
    # Get the query from command line arguments or prompt the user
    if args.query:
        query = " ".join(args.query)
    else:
        query = input("Enter your query: ")
    
    print(f"\nProcessing query: {query}\n")
    
    try:
        # Process the query
        result = agent.process_query(query)
        
        # Output the results
        if args.json:
            # Output in JSON format
            print(json.dumps(result, indent=2))
        else:
            # Output in human-readable format
            if result["query_type"] == "simple":
                print("Query Type: Simple")
                print("-" * 80)
                print(result["response"])
                print("-" * 80)
                print(f"Tokens used: {result['tokens_used']}")
            else:
                print(f"Query Type: Research on {result['company_name']}")
                print(f"Official Website: {result['official_website']}")
                print("-" * 80)
                print(result["research_report"])
                print("-" * 80)
        
        # Save results to file if requested
        if args.save:
            with open(args.save, "w") as f:
                if args.json:
                    json.dump(result, f, indent=2)
                else:
                    if result["query_type"] == "simple":
                        f.write(f"Query: {query}\n")
                        f.write(f"Query Type: Simple\n")
                        f.write("-" * 80 + "\n")
                        f.write(result["response"] + "\n")
                    else:
                        f.write(f"Query: {query}\n")
                        f.write(f"Query Type: Research on {result['company_name']}\n")
                        f.write(f"Official Website: {result['official_website']}\n")
                        f.write("-" * 80 + "\n")
                        f.write(result["research_report"] + "\n")
            
            print(f"\nResults saved to {args.save}")
        
        return 0
    
    except Exception as e:
        print(f"Error: {str(e)}")
        return 1

if __name__ == "__main__":
    exit(main()) 