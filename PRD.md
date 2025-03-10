Competitive Research Agent - Product Requirements Document (PRD)

Version: 1.1
Last Updated: March 10, 2025
1. Overview

The Competitive Research Agent is a Cloudflare-based web scraper and AI-powered reporting system that extracts data from target URLs, generates structured reports, and provides insights for competitive analysis.

This document outlines the V1 implementation, which includes:

    Web scraping via Cloudflare Workers
    Task management using Durable Objects
    Data storage in Cloudflare R2
    AI-powered report generation via Cloudflare AI Gateway
    Monitoring API usage, cost, and latency using AI Gateway

2. Goals & Success Metrics
2.1 Goals

    Provide a scalable, Cloudflare-native solution for competitive research.
    Ensure low-latency data extraction and report generation.
    Implement cost-effective AI processing using Cloudflare AI Gateway to monitor API costs/latency.

2.2 Success Metrics

    Response time: Scraping tasks complete within ≤2s for basic HTML pages.
    Reliability: ≥ 99.5% uptime for API endpoints.
    Scalability: Handle 100 concurrent scraping jobs.
    Cost Monitoring: AI Gateway tracks latency & costs per API call.

3. Development Roadmap

The project follows a structured development order to ensure modularity and scalability.
Phase 1: Cloudflare Worker for URL Submission

    ✅ Create a Cloudflare Worker that:
        Accepts POST /scrape requests with a targetUrl.
        Calls a Durable Object to manage the research task.
        Returns a task ID for tracking.

Implementation Steps:

    Set up Cloudflare Workers (wrangler init research-agent).
    Implement API request validation (e.g., checking valid URLs).
    Bind the Durable Object (next phase).

Phase 2: Durable Object for Task Management

    ✅ Implement a Durable Object (DO) to:
        Track scraping progress (Pending, In-Progress, Completed).
        Handle task state storage.
        Assign unique scraping jobs to Cloudflare Workers.

Implementation Steps:

    Define Durable Object Class (wrangler generate durable-object ResearchDO).
    Implement task tracking (storage.put("status", "Scraping")).
    Link the Durable Object to Workers for seamless job management.

Phase 3: Web Scraping Worker

    ✅ Implement a scraping function that:
        Fetches the HTML of the given URL.
        Extracts metadata (e.g., <title>, meta description).
        Handles basic error cases (timeouts, redirects, etc.).

Implementation Steps:

    Use fetch() inside the Worker to retrieve the webpage.
    Parse response using Cloudflare's HTMLRewriter API.
    Store the extracted data in Durable Objects.

Phase 4: Storing Reports in Cloudflare R2

    ✅ Store scraped data and generated reports in R2 Storage.
    ✅ Ensure reports are publicly accessible via pre-signed URLs.

Implementation Steps:

    Create an R2 bucket (research-reports).
    Bind R2 in wrangler.toml ([[r2_buckets]]).
    Implement Worker logic to upload reports.

Phase 5: AI-Powered Report Generation (Using Cloudflare AI Gateway)

    ✅ Generate structured reports using AI models via Cloudflare AI Gateway.
    ✅ Track API costs & latency using AI Gateway’s built-in observability.
    ✅ Implement caching & request optimization to reduce API calls.

Implementation Steps:

    Enable AI Gateway in Cloudflare Dashboard.
    Set up AI Gateway with OpenAI API.
    Modify Worker to route AI requests through AI Gateway:

    curl -X POST https://ai-gateway.example.com/openai/completions \
      -H "Authorization: Bearer API_KEY" \
      -H "Content-Type: application/json" \
      -d '{ "model": "gpt-4", "messages": [{"role": "user", "content": "Summarize this webpage..."}] }'

    Enable Caching & Rate Limiting in AI Gateway to optimize performance.

4. System Architecture
4.1 Components
Component	Technology	Purpose
Workers	Cloudflare Workers	API gateway, scraping execution
Durable Objects	Cloudflare Durable Objects	Track scraping tasks, manage state
Storage	Cloudflare R2	Store scraped reports
AI Processing	Cloudflare AI Gateway + OpenAI API	Generate structured reports
Monitoring	Cloudflare AI Gateway Logs	Track API cost, latency, request volume
5. API Design
5.1 Scrape Request

    Endpoint: POST /scrape
    Request Body:

{
  "targetUrl": "https://example.com"
}

Response:

    {
      "status": "queued",
      "jobId": "12345"
    }

5.2 Report Retrieval

    Endpoint: GET /report?jobId=12345
    Response:

    {
      "status": "completed",
      "reportUrl": "https://r2.example.com/reports/12345.json"
    }

6. Security Considerations

    Authentication: Require API keys for external access.
    Rate Limiting: Use Cloudflare AI Gateway to control API request volume.
    Bot Detection Bypass: Rotate User-Agent headers and implement retry logic.

7. Performance & Scaling
Potential Bottleneck	Mitigation Strategy
Long-running scrapes	Use Durable Objects to manage state
High API costs	Use AI Gateway’s cost tracking & caching
Scraping rate limits	Implement queue-based execution
AI request latency	Enable caching in AI Gateway to store common responses
