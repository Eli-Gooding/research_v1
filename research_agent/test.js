/**
 * Simple test script to verify the Research Agent API
 * 
 * Usage:
 * 1. Deploy the worker: npm run deploy
 * 2. Run this script: node test.js
 */

// Replace with your worker URL after deployment
const WORKER_URL = 'https://research-agent.your-account.workers.dev';

async function testResearchAgent() {
  console.log('Testing Research Agent API...');
  
  // Test URL submission
  console.log('\n1. Testing URL submission...');
  const submitResponse = await fetch(`${WORKER_URL}/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      targetUrl: 'https://example.com'
    })
  });
  
  const submitResult = await submitResponse.json();
  console.log('Response:', submitResult);
  
  if (!submitResult.jobId) {
    console.error('Error: No job ID returned');
    return;
  }
  
  const jobId = submitResult.jobId;
  console.log(`Job ID: ${jobId}`);
  
  // Test task status
  console.log('\n2. Testing task status...');
  const statusResponse = await fetch(`${WORKER_URL}/task/${jobId}`);
  const statusResult = await statusResponse.json();
  console.log('Response:', statusResult);
  
  // Note: The report won't be available immediately since we haven't implemented
  // the scraping and report generation yet, but we can test the endpoint
  console.log('\n3. Testing report retrieval (expected to fail)...');
  const reportResponse = await fetch(`${WORKER_URL}/report/${jobId}`);
  const reportResult = await reportResponse.json();
  console.log('Response:', reportResult);
  
  console.log('\nTest completed!');
}

testResearchAgent().catch(error => {
  console.error('Test failed:', error);
}); 