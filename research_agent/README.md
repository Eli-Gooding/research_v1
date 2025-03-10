# Competitive Research Agent

A Cloudflare-based web scraper and AI-powered reporting system that extracts data from target URLs, generates structured reports, and provides insights for competitive analysis.

## Overview

This project implements a research agent that:
- Accepts URLs for scraping via a simple API
- Manages scraping tasks using Durable Objects
- Stores reports in Cloudflare R2
- Generates AI-powered reports using Cloudflare AI Gateway

## Project Structure

```
research_agent/
├── src/
│   └── index.ts       # Main Worker code
├── package.json       # Dependencies and scripts
├── tsconfig.json      # TypeScript configuration
├── wrangler.toml      # Cloudflare Workers configuration
└── README.md          # This file
```

## Development Phases

The project is being developed in phases:

1. **Phase 1**: Cloudflare Worker for URL Submission ✅
   - Create a Worker that accepts POST /scrape requests with a targetUrl
   - Call a Durable Object to manage the research task
   - Return a task ID for tracking

2. **Phase 2**: Durable Object for Task Management
   - Track scraping progress (Pending, In-Progress, Completed)
   - Handle task state storage
   - Assign scraping jobs to Workers

3. **Phase 3**: Web Scraping Worker
   - Fetch HTML of the given URL
   - Extract metadata
   - Handle basic error cases

4. **Phase 4**: Storing Reports in Cloudflare R2
   - Store scraped data and reports in R2 Storage
   - Make reports accessible via pre-signed URLs

5. **Phase 5**: AI-Powered Report Generation
   - Generate structured reports using AI models via Cloudflare AI Gateway
   - Track API costs & latency
   - Implement caching & request optimization

## Getting Started

### Prerequisites

- Node.js (v16.17.0 or later)
- npm or yarn
- Cloudflare account with Workers, R2, and AI Gateway access

### Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Configure your Cloudflare account:
   ```
   npx wrangler login
   ```
4. Create an R2 bucket:
   ```
   npx wrangler r2 bucket create research-reports
   ```

### Development

Run the project locally:
```
npm run dev
```

### Deployment

Deploy to Cloudflare Workers:
```
npm run deploy
```

## API Endpoints

### Submit URL for Scraping

```
POST /scrape
Content-Type: application/json

{
  "targetUrl": "https://example.com"
}
```

Response:
```json
{
  "status": "queued",
  "jobId": "12345"
}
```

### Check Task Status

```
GET /task/12345
```

Response:
```json
{
  "status": "completed",
  "targetUrl": "https://example.com",
  "taskId": "12345",
  "createdAt": "2025-03-10T12:34:56Z"
}
```

### Get Report

```
GET /report/12345
```

Response:
```json
{
  "status": "completed",
  "reportUrl": "https://r2.example.com/reports/12345.json"
}
```

## License

MIT 