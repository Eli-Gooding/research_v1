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
5. Install AWS SDK for R2 presigned URLs:
   ```
   npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
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
  "reportId": "12345",
  "reportUrl": "https://example-r2.cloudflarestorage.com/research-reports/12345.json?X-Amz-Algorithm=...",
  "reportSize": 12345,
  "reportEtag": "abc123",
  "expiresIn": "1 hour"
}
```

### List All Reports

```
GET /reports
```

Response:
```json
{
  "status": "success",
  "count": 2,
  "reports": [
    {
      "reportId": "12345",
      "size": 12345,
      "etag": "abc123",
      "uploaded": "2025-03-10T12:34:56Z"
    },
    {
      "reportId": "67890",
      "size": 67890,
      "etag": "def456",
      "uploaded": "2025-03-10T13:45:67Z"
    }
  ]
}
```

## R2 Storage Integration

This project uses Cloudflare R2 for storing scraped reports. R2 is Cloudflare's object storage service, similar to AWS S3 but with no egress fees.

### How R2 is Used in This Project

1. **Report Storage**: When a scraping task is completed, the report is stored as a JSON file in the R2 bucket.
2. **Presigned URLs**: The `/report/:id` endpoint generates a presigned URL that allows temporary access to the report.
3. **Report Listing**: The `/reports` endpoint lists all available reports in the R2 bucket.

### R2 Configuration

The R2 bucket is configured in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "RESEARCH_REPORTS"
bucket_name = "research-reports"
```

## Production Deployment Considerations

When deploying to production, keep the following in mind:

1. **R2 Bucket Setup**: Ensure your R2 bucket is created in your Cloudflare account:
   ```
   npx wrangler r2 bucket create research-reports
   ```

2. **Environment Detection**: The code automatically detects whether it's running in local development or production and adapts its behavior accordingly:
   - In local development: Reports are served directly in the response
   - In production: Presigned URLs are generated for accessing reports

3. **Presigned URLs**: The presigned URL generation uses the AWS SDK. In production, Cloudflare Workers automatically handle authentication to R2.

4. **Direct Download Endpoint**: The `/download/:id` endpoint works in both environments and provides a reliable fallback if users encounter issues with presigned URLs.

5. **CORS Configuration**: You may need to configure CORS for your R2 bucket in production to allow access from your frontend.

6. **Worker Domain**: Update the `WORKER_URL` in `public/index.html` to point to your production Worker domain.

## License

MIT 