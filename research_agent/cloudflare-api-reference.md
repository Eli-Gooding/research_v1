# Cloudflare API Reference Guide

This document provides a comprehensive reference for Cloudflare Workers, Durable Objects, R2, and AI Gateway APIs as of February 2025.

## Table of Contents

- [Package Versions](#package-versions)
- [Workers API](#workers-api)
- [Durable Objects API](#durable-objects-api)
- [R2 Storage API](#r2-storage-api)
- [AI Gateway API](#ai-gateway-api)
- [Common Issues and Solutions](#common-issues-and-solutions)

## Package Versions

| Package | Latest Version | Notes |
|---------|---------------|-------|
| `wrangler` | 3.109.1 | CLI tool for building Cloudflare Workers |
| `@cloudflare/workers-types` | 4.20250214.0 | TypeScript definitions for Cloudflare Workers |
| TypeScript | 5.4.x | Recommended version |

## Workers API

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "lib": ["ES2020", "DOM", "WebWorker"],
    "types": ["@cloudflare/workers-types"],
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Environment Interface

```typescript
export interface Env {
  // Durable Object namespace
  MY_DURABLE_OBJECT: DurableObjectNamespace;
  
  // R2 bucket
  MY_BUCKET: R2Bucket;
  
  // KV namespace
  MY_KV: KVNamespace;
  
  // AI Gateway
  MY_AI_GATEWAY: any;
  
  // Environment variables
  MY_ENV_VAR: string;
  MY_SECRET: string;
}
```

### Basic Worker Structure

```typescript
import { 
  DurableObjectNamespace, 
  DurableObjectState, 
  R2Bucket, 
  ExecutionContext,
  KVNamespace
} from '@cloudflare/workers-types';

export interface Env {
  // Your bindings here
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Your code here
    return new Response('Hello World');
  }
};
```

### Wrangler Configuration

```toml
name = "my-worker"
main = "src/index.ts"
compatibility_date = "2024-03-10"

# Durable Object binding
[durable_objects]
bindings = [
  { name = "MY_DURABLE_OBJECT", class_name = "MyDurableObject" }
]

# Durable Object migrations
[[migrations]]
tag = "v1"
new_classes = ["MyDurableObject"]

# R2 bucket binding
[[r2_buckets]]
binding = "MY_BUCKET"
bucket_name = "my-bucket"

# KV namespace binding
[[kv_namespaces]]
binding = "MY_KV"
id = "your-kv-namespace-id"

# AI Gateway binding
[ai]
binding = "MY_AI_GATEWAY"

# Serve static assets
[site]
bucket = "./public"
```

## Durable Objects API

### Durable Object Class

```typescript
export class MyDurableObject {
  state: DurableObjectState;
  env: Env;
  
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }
  
  // Handle fetch requests to the Durable Object
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Your code here
    
    return new Response('Hello from Durable Object');
  }
}
```

### Creating and Using Durable Objects

```typescript
// Creating a Durable Object ID
const id = env.MY_DURABLE_OBJECT.idFromName("unique-name");
// OR
const id = env.MY_DURABLE_OBJECT.newUniqueId();

// Getting a stub for the Durable Object
const stub = env.MY_DURABLE_OBJECT.get(id);

// Calling the Durable Object via fetch
const response = await stub.fetch("http://do/path", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: "value" })
});

// Using RPC (Remote Procedure Call) - available since 2024-04-05
const result = await stub.hello("World");
```

### Durable Object Storage API

```typescript
// Store data
await this.state.storage.put("key", "value");
await this.state.storage.put("object", { foo: "bar" });

// Retrieve data
const value = await this.state.storage.get("key");
const values = await this.state.storage.get(["key1", "key2"]);

// Delete data
await this.state.storage.delete("key");

// List keys
const keys = await this.state.storage.list();
const keysWithPrefix = await this.state.storage.list({ prefix: "user:" });

// Transaction
await this.state.storage.transaction(async (txn) => {
  const value = await txn.get("counter") || 0;
  await txn.put("counter", value + 1);
});
```

## R2 Storage API

### Basic R2 Operations

```typescript
// Get an object
const object = await env.MY_BUCKET.get("file.txt");
if (object === null) {
  return new Response("Not found", { status: 404 });
}

// Get object as stream
const data = await object.arrayBuffer();
// OR
const stream = object.body;

// Get object metadata
const { size, uploaded, etag, httpMetadata, customMetadata } = object;

// Put an object
await env.MY_BUCKET.put("file.txt", "Hello World");
// OR with options
await env.MY_BUCKET.put("file.txt", new Uint8Array([...]), {
  httpMetadata: {
    contentType: "text/plain",
    cacheControl: "max-age=3600",
  },
  customMetadata: {
    userId: "user123",
  },
  storageClass: "STANDARD", // or "INFREQUENT_ACCESS"
});

// Delete an object
await env.MY_BUCKET.delete("file.txt");

// List objects
const listed = await env.MY_BUCKET.list({
  prefix: "folder/",
  limit: 100,
});

for (const object of listed.objects) {
  console.log(object.key, object.size);
}

// Check if there are more objects
if (listed.truncated) {
  // Use listed.cursor for the next request
}
```

### R2 Presigned URLs

R2 doesn't have a direct `createPresignedUrl` method in the Workers API. Instead, you need to use the S3 compatibility API with libraries like `@aws-sdk/s3-request-presigner`.

## AI Gateway API

### Configuring AI Gateway

```typescript
// Using OpenAI with AI Gateway
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: 'your-openai-api-key',
  baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/openai`
});

// Make a request
const response = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello, world!" }
  ]
});
```

### Using Anthropic with AI Gateway

```typescript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: 'your-anthropic-api-key',
  baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/anthropic`
});

const message = await anthropic.messages.create({
  model: "claude-3-opus-20240229",
  messages: [{ role: "user", content: "What is Cloudflare?" }],
  max_tokens: 1024
});
```

### Universal Endpoint

```typescript
// Using the Universal Endpoint for fallbacks
const response = await fetch(`https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify([
    {
      // Primary provider
      "provider": "workers-ai",
      "endpoint": "@cf/meta/llama-2-7b-chat-int8",
      "headers": {
        "Authorization": "Bearer your-cloudflare-token",
        "Content-Type": "application/json"
      },
      "query": {
        "messages": [
          {
            "role": "system",
            "content": "You are a friendly assistant"
          },
          {
            "role": "user",
            "content": "What is Cloudflare?"
          }
        ]
      }
    },
    {
      // Fallback provider
      "provider": "openai",
      "endpoint": "chat/completions",
      "headers": {
        "Authorization": "Bearer your-openai-token",
        "Content-Type": "application/json"
      },
      "query": {
        "model": "gpt-3.5-turbo",
        "messages": [
          {
            "role": "user",
            "content": "What is Cloudflare?"
          }
        ]
      }
    }
  ])
});
```

## Common Issues and Solutions

### TypeScript Type Issues

If you encounter type errors with `@cloudflare/workers-types`, try one of these solutions:

1. **Pin `@types/node` version**: If your project's dependencies load the `@types/node` package, it may override types from `@cloudflare/workers-types`. Pin the version in your `package.json`:

```json
{
  "overrides": {
    "@types/node": "20.8.3"
  }
}
```

2. **Generate runtime types with Wrangler**: As of `wrangler 3.66.0`, you can generate types that match your Worker's configuration:

```bash
npx wrangler types --experimental-include-runtime
```

Then update your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["./.wrangler/types/runtime"]
  }
}
```

### R2 Presigned URLs

To generate presigned URLs for R2, you need to use the S3 compatibility API:

1. Install the required packages:
```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

2. Use the S3 client to generate presigned URLs:
```typescript
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Initialize the S3 client
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: "your-access-key-id",
    secretAccessKey: "your-secret-access-key"
  }
});

// Generate a presigned URL
const command = new GetObjectCommand({
  Bucket: "your-bucket-name",
  Key: "your-file-key"
});

const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
```

### Durable Object Limitations

- Durable Objects are not globally replicated; they run in a single location.
- There's a limit to how many Durable Objects you can create.
- Durable Objects have storage limits.
- Refer to the [Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/) documentation for current values.

### AI Gateway Rate Limits

- AI Gateway has rate limits that vary by plan.
- You can configure custom rate limits in the Cloudflare dashboard.
- For high-volume applications, consider implementing retry logic with exponential backoff. 