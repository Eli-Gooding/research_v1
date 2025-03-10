/**
 * Simple test script to verify the Research Agent API
 * 
 * Usage:
 * 1. Deploy the worker: npm run deploy
 * 2. Run this script: node test.js
 */

// Use localhost for local testing
const WORKER_URL = 'http://localhost:8787';

// Function to submit a URL for scraping
async function submitUrl(url) {
  console.log(`Submitting URL for scraping: ${url}`);
  
  try {
    const response = await fetch(`${WORKER_URL}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ targetUrl: url })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to submit URL: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('URL submitted successfully:', data);
    return data.jobId;
  } catch (error) {
    console.error('Error submitting URL:', error);
    throw error;
  }
}

// Function to check the status of a scraping task
async function checkTaskStatus(jobId) {
  console.log(`Checking status of task: ${jobId}`);
  
  try {
    const response = await fetch(`${WORKER_URL}/task/${jobId}`);
    
    if (!response.ok) {
      throw new Error(`Failed to check task status: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Task status:', data);
    return data;
  } catch (error) {
    console.error('Error checking task status:', error);
    throw error;
  }
}

// Function to get the report for a completed task
async function getReport(jobId) {
  console.log(`Getting report for task: ${jobId}`);
  
  try {
    const response = await fetch(`${WORKER_URL}/report/${jobId}`);
    
    if (!response.ok) {
      throw new Error(`Failed to get report: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Report URL:', data.reportUrl);
    
    // Fetch the actual report
    const reportResponse = await fetch(data.reportUrl);
    if (!reportResponse.ok) {
      throw new Error(`Failed to fetch report content: ${reportResponse.status} ${reportResponse.statusText}`);
    }
    
    const report = await reportResponse.json();
    console.log('Report content:', JSON.stringify(report, null, 2));
    
    // Check if AI insights are present
    if (report.aiInsights) {
      console.log('AI Insights:', JSON.stringify(report.aiInsights, null, 2));
    } else {
      console.log('No AI insights found in the report');
    }
    
    return report;
  } catch (error) {
    console.error('Error getting report:', error);
    throw error;
  }
}

// Main test function
async function runTest() {
  try {
    // Submit a URL for scraping
    const jobId = await submitUrl('https://example.com');
    
    // Poll for task completion
    let taskStatus;
    do {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between checks
      taskStatus = await checkTaskStatus(jobId);
    } while (taskStatus.status !== 'completed' && taskStatus.status !== 'error');
    
    // If the task completed successfully, get the report
    if (taskStatus.status === 'completed') {
      const report = await getReport(jobId);
      
      // Verify AI insights
      if (report.aiInsights && report.aiInsights.insights) {
        console.log('✅ AI report generation test passed!');
      } else {
        console.log('❌ AI report generation test failed: No insights found');
      }
    } else {
      console.log('❌ Task failed with error:', taskStatus.error);
    }
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
runTest(); 