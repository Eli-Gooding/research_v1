# Company Research Agent

An AI-powered distributed research agent that automatically gathers comprehensive information about companies using parallel research tasks.

## Architecture

This project uses a distributed architecture with Cloudflare Workers and PartyKit to perform parallel research on different aspects of a company:

```
┌────────────┐        ┌────────────┐        ┌────────────┐
│            │        │            │        │            │
│  Frontend  │◄─────► │ API Worker │◄─────► │ R2 Storage │
│            │        │            │        │            │
└────────────┘        └────────────┘        └────────────┘
      ▲                      ▲                    ▲
      │                      │                    │
      ▼                      ▼                    │
┌────────────┐        ┌────────────┐             │
│            │        │ Research   │             │
│ PartyKit   │◄─────► │ Workers    │─────────────┘
│ Server     │        │ (Parallel) │
│            │        │            │
└────────────┘        └────────────┘
      ▲                      ▲
      │                      │
      │                      │
      ▼                      ▼
┌────────────┐        ┌────────────┐
│            │        │            │
│Compilation │        │ AI Gateway │
│ Worker     │        │            │
│            │        │            │
└────────────┘        └────────────┘
```

### Components

1. **Frontend**: A simple HTML/CSS/JS client for interacting with the research agent.

2. **API Worker**: Handles incoming requests, creates research jobs, and returns results.

3. **PartyKit Server**: Coordinates the parallel research tasks and manages real-time updates.

4. **Research Workers**: Perform parallel research on different aspects of a company (overview, customers, products, pricing, competitors).

5. **Compilation Worker**: Gathers all research and compiles a comprehensive final report.

6. **R2 Storage**: Stores job metadata, individual research results, and final reports.

7. **AI Gateway**: Tracks token usage, costs, and latency for AI model calls.

## Quick Start

### Prerequisites

- Node.js v18+ and npm
- Cloudflare Workers account (for production deployment)
- PartyKit account (for production deployment)
- OpenAI API key

### Local Development

1. **Clone this repository**:
   ```bash
   git clone <repository-url>
   cd search_test
   ```

2. **Set up environment variables**:
   
   Create a `.dev.vars` file for Cloudflare Workers:
   ```
   # OpenAI API Key (required)
   OPENAI_API_KEY=sk-your-actual-openai-key

   # Other variables as needed
   ```

   Create a `.env.party` file for PartyKit:
   ```
   # OpenAI API Key
   OPENAI_API_KEY=sk-your-actual-openai-key
   
   # Local worker URLs
   RESEARCH_WORKER_URL=http://localhost:8787/research
   COMPILATION_WORKER_URL=http://localhost:8787/compilation
   ```

3. **Install dependencies and check system**:
   ```bash
   node init.js
   ```

4. **Start the development servers**:
   ```bash
   npm run dev
   ```

   This will start:
   - Cloudflare Workers on http://localhost:8787
   - PartyKit server on http://localhost:1999
   - Static file server on http://localhost:3000

5. **Open the web interface**:
   Open http://localhost:3000 in your browser

### Production Deployment

#### Environment Variables

For production, you'll need to set these variables in your deployment environment:

```
# Cloudflare Workers
OPENAI_API_KEY=sk-xxx
AI_GATEWAY_API_KEY=xxx
AI_GATEWAY_ENDPOINT=https://api.aigateway.io/v1
PARTYKIT_URL=https://your-partykit-project.username.partykit.dev

# PartyKit
OPENAI_API_KEY=sk-xxx
AI_GATEWAY_API_KEY=xxx
RESEARCH_WORKER_URL=https://research.your-domain.com
COMPILATION_WORKER_URL=https://compilation.your-domain.com
```

#### Deployment Steps

1. **Deploy the Workers**:

```bash
cd search_test
npm run deploy:workers
```

2. **Deploy the PartyKit Server**:

```bash
cd search_test
npm run deploy:party
```

3. **Update the Frontend**:

Update the configuration in `index.html` with your production URLs:

```javascript
const config = {
  apiBaseUrl: 'https://api.your-domain.com',
  partyKitUrl: 'https://your-partykit-project.username.partykit.dev',
  roomId: 'search-agent'
};
```

Then deploy the static assets to your preferred hosting service.

4. **Setup R2 Storage**:

Create an R2 bucket in your Cloudflare dashboard and update the wrangler.toml configuration:

```toml
[[r2_buckets]]
binding = "STORAGE_BUCKET"
bucket_name = "research-agent-storage"
```

## Usage

1. Open the frontend in a web browser
2. Enter a company name to research (e.g., "Research about Airbnb")
3. Optionally provide the company's website for more accurate results
4. Click "Research" and wait for the parallel research tasks to complete
5. View the compiled research report with detailed information about the company

## How It Works

1. The frontend sends a query to the API worker
2. The API worker creates a new job and stores the initial metadata in R2
3. The PartyKit server is notified about the new job
4. PartyKit triggers parallel research tasks for different aspects of the company
5. Each research worker stores its results in R2 and updates the job status
6. When all research is complete, the compilation worker creates a final report
7. The frontend displays the research results in a formatted view

## Extending the Agent

### Adding New Research Categories

To add a new research category:

1. Update the categories array in `api.js`:

```javascript
const categories = [
  'overview',
  'customers',
  'products',
  'pricing',
  'competitors',
  'new-category'
];
```

2. Update the UI category icons in `index.html`:

```javascript
const categoryIcons = {
  // ...existing categories
  'new-category': '🔍'
};
```

### Customizing AI Models

You can customize the AI models used for different tasks by modifying the `research.js` and `compilation.js` files:

```javascript
// For research tasks
const response = await callOpenAI(env, 'gpt-4o', messages, {
  temperature: 0.1,
  max_tokens: 3000,
  fallbackModel: 'gpt-3.5-turbo-0125'
});

// For compilation
const response = await callOpenAI(env, 'gpt-4o', messages, {
  temperature: 0.2,
  max_tokens: 4000
});
```

## Troubleshooting

### Connectivity Issues

If you're having trouble connecting to the PartyKit server:

1. Check that all services are running (`npm run dev`)
2. Verify that your PartyKit URL is correct in the frontend
3. Check the console for any error messages

### OpenAI API Key Issues

If you're seeing errors related to the OpenAI API:

1. Ensure your API key is set correctly in both `.dev.vars` and `.env.party`
2. Check that your OpenAI account has access to the required models (e.g., gpt-4o)
3. Verify that your API key has sufficient quota remaining

## License

MIT 