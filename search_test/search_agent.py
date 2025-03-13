import os
import json
import re
from typing import Dict, List, Optional, Union, Any
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Import OpenAI library
from openai import OpenAI

# Initialize the OpenAI client
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

class SearchAgent:
    """
    A search agent that can handle both simple answer queries and detailed research queries.
    Uses OpenAI's web search feature to gather information.
    """
    
    def __init__(self, model: str = "gpt-4o"):
        """
        Initialize the search agent.
        
        Args:
            model: The OpenAI model to use for processing queries
        """
        self.model = model
        self.client = client
    
    def process_query(self, user_query: str) -> Dict[str, Any]:
        """
        Process a user query and determine whether it requires a simple answer or a detailed research.
        
        Args:
            user_query: The user's query string
            
        Returns:
            A dictionary containing the response and metadata
        """
        # First, determine if this is a simple query or needs research
        query_type = self._determine_query_type(user_query)
        
        if query_type == "simple":
            return self._handle_simple_query(user_query)
        else:
            return self._handle_research_query(user_query)
    
    def _determine_query_type(self, query: str) -> str:
        """
        Determine if the query requires a simple answer or detailed research.
        
        Args:
            query: The user's query
            
        Returns:
            "simple" or "research"
        """
        # Use the model to determine if this is a simple query or needs research
        system_prompt = """
        You are an AI assistant that determines whether a user query requires:
        1. A simple answer that can be provided with a quick web search
        2. A detailed research about a company, requiring multiple searches and analysis
        
        If the query mentions a specific company and asks about its products, features, pricing, 
        customers, or market positioning, classify it as "research".
        
        Otherwise, classify it as "simple".
        
        Respond with ONLY "simple" or "research".
        """
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": query}
                ],
                max_tokens=10
            )
            
            result = response.choices[0].message.content.strip().lower()
            return "research" if "research" in result else "simple"
        except Exception as e:
            print(f"Error determining query type: {str(e)}")
            # Default to simple if there's an error
            return "simple"
    
    def _handle_simple_query(self, query: str) -> Dict[str, Any]:
        """
        Handle a simple query using web search.
        
        Args:
            query: The user's query
            
        Returns:
            A dictionary with the response
        """
        # Use the web search feature to get a simple answer
        try:
            # First try with the search-preview model
            model_to_use = f"{self.model}-search-preview"
            response = self.client.chat.completions.create(
                model=model_to_use,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that provides accurate, concise answers using web search."},
                    {"role": "user", "content": query}
                ]
            )
        except Exception as e:
            print(f"Error with search-preview model: {str(e)}")
            # Fallback to regular model if search-preview is not available
            model_to_use = self.model
            response = self.client.chat.completions.create(
                model=model_to_use,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that provides accurate, concise answers."},
                    {"role": "user", "content": query}
                ]
            )
        
        return {
            "query_type": "simple",
            "original_query": query,
            "response": response.choices[0].message.content,
            "tokens_used": response.usage.total_tokens,
            "model_used": model_to_use
        }
    
    def _handle_research_query(self, query: str) -> Dict[str, Any]:
        """
        Handle a detailed research query about a company.
        
        Args:
            query: The user's query
            
        Returns:
            A dictionary with the research results
        """
        # Extract the company name from the query
        company_name = self._extract_company_name(query)
        
        if not company_name:
            # If no company name was found, treat it as a simple query
            return self._handle_simple_query(query)
        
        # Step 1: Find the official website
        official_website = self._find_official_website(company_name)
        
        # Step 2: Research the company's products, features, pricing, and market positioning
        research_results = self._research_company(company_name, official_website)
        
        # Step 3: Compile the final research report
        final_report = self._compile_research_report(company_name, research_results)
        
        return {
            "query_type": "research",
            "original_query": query,
            "company_name": company_name,
            "official_website": official_website,
            "research_report": final_report,
            "research_data": research_results["results"],
            "models_used": research_results["models_used"]
        }
    
    def _extract_company_name(self, query: str) -> Optional[str]:
        """
        Extract the company name from the query.
        
        Args:
            query: The user's query
            
        Returns:
            The extracted company name or None if not found
        """
        system_prompt = """
        Extract the company name from the following query. 
        If there is no specific company mentioned, respond with "None".
        Respond with ONLY the company name or "None".
        """
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": query}
                ],
                max_tokens=50
            )
            
            result = response.choices[0].message.content.strip()
            return None if result.lower() == "none" else result
        except Exception as e:
            print(f"Error extracting company name: {str(e)}")
            return None
    
    def _find_official_website(self, company_name: str) -> str:
        """
        Find the official website for the company.
        
        Args:
            company_name: The name of the company
            
        Returns:
            The URL of the official website
        """
        search_query = f"{company_name} official website"
        
        try:
            # Try with search-preview model
            model_to_use = f"{self.model}-search-preview"
            response = self.client.chat.completions.create(
                model=model_to_use,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that finds official company websites. Respond with ONLY the URL of the official website."},
                    {"role": "user", "content": search_query}
                ],
                max_tokens=100
            )
        except Exception as e:
            print(f"Error with search-preview model: {str(e)}")
            # Fallback to regular model
            model_to_use = self.model
            response = self.client.chat.completions.create(
                model=model_to_use,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that finds official company websites. Respond with ONLY the URL of the official website."},
                    {"role": "user", "content": search_query}
                ],
                max_tokens=100
            )
        
        # Extract URL from the response
        content = response.choices[0].message.content
        urls = re.findall(r'https?://(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)', content)
        
        if urls:
            return urls[0]
        else:
            # If no URL was found, extract it manually
            return content.strip()
    
    def _research_company(self, company_name: str, website: str) -> Dict[str, Any]:
        """
        Research the company's products, features, pricing, and market positioning.
        
        Args:
            company_name: The name of the company
            website: The company's official website
            
        Returns:
            A dictionary with the research results
        """
        # Research categories
        categories = [
            "customers and target audience",
            "products and services",
            "features and capabilities",
            "pricing information",
            "market positioning and competitors"
        ]
        
        results = {}
        models_used = {}
        
        for category in categories:
            search_query = f"{company_name} {category}"
            
            # Use the website in the query if available
            if website and "http" in website:
                search_query += f" site:{website.split('//')[1].split('/')[0]}"
            
            system_prompt = f"""
            You are a research assistant gathering information about {company_name}'s {category}.
            Provide detailed, factual information based on web search results.
            Include specific details when available.
            Cite your sources with URLs when possible.
            """
            
            try:
                # Try with search-preview model
                model_to_use = f"{self.model}-search-preview"
                response = self.client.chat.completions.create(
                    model=model_to_use,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": search_query}
                    ],
                    max_tokens=1000
                )
            except Exception as e:
                print(f"Error with search-preview model for {category}: {str(e)}")
                # Fallback to regular model
                model_to_use = self.model
                response = self.client.chat.completions.create(
                    model=model_to_use,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": search_query}
                    ],
                    max_tokens=1000
                )
            
            results[category] = response.choices[0].message.content
            models_used[category] = model_to_use
        
        return {
            "results": results,
            "models_used": models_used
        }
    
    def _compile_research_report(self, company_name: str, research_results: Dict[str, Any]) -> str:
        """
        Compile the final research report based on the gathered information.
        
        Args:
            company_name: The name of the company
            research_results: The research results for each category
            
        Returns:
            The compiled research report
        """
        # Combine all research results into a single context
        combined_research = "\n\n".join([f"## {category.title()}\n{results}" for category, results in research_results["results"].items()])
        
        system_prompt = f"""
        You are a business analyst creating a comprehensive research report about {company_name}.
        
        Based on the provided research data, create a well-structured report that covers:
        1. Company Overview
        2. Target Customers and Audience
        3. Products and Services
        4. Key Features and Capabilities
        5. Pricing Structure
        6. Market Positioning and Competitive Analysis
        7. Summary and Insights
        
        Use markdown formatting for better readability.
        Maintain factual accuracy and cite sources where appropriate.
        """
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": combined_research}
                ],
                max_tokens=2000
            )
            
            return response.choices[0].message.content
        except Exception as e:
            print(f"Error compiling research report: {str(e)}")
            return "Error generating research report. Please try again."


# Example usage
if __name__ == "__main__":
    agent = SearchAgent()
    
    # Example simple query
    simple_result = agent.process_query("What is the capital of France?")
    print(f"Simple Query Result: {simple_result['response']}\n")
    
    # Example research query
    research_result = agent.process_query("Tell me about Stripe's products, pricing, and market position.")
    print(f"Research Query Result for {research_result['company_name']}:\n{research_result['research_report']}")
