// Debug script to test direct fetch from PartyKit-like environment to worker
import { createServer } from 'http';

// Create a simple HTTP server that simulates PartyKit
const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/test') {
    console.log('Received test request, will attempt to fetch the research worker');
    
    try {
      // Construct a request body similar to what PartyKit would send
      const body = JSON.stringify({
        jobId: 'debug-test-' + Date.now(),
        companyName: 'DebugCompany',
        category: 'overview',
        categoryKey: 'overview',
        website: 'debugcompany.com'
      });
      
      console.log(`Request body: ${body}`);
      console.log('Initiating fetch to research worker...');
      
      // Attempt to fetch the research worker
      const response = await fetch('http://localhost:8787/research', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body
      });
      
      console.log(`Research worker responded with status: ${response.status}`);
      
      const text = await response.text();
      console.log(`Research worker response: ${text}`);
      
      // Send success response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true, 
        workerResponse: text 
      }));
    } catch (error) {
      console.error('Error fetching research worker:', error);
      console.error(`Error message: ${error.message}`);
      
      if (error.code) {
        console.error(`Network error code: ${error.code}`);
      }
      
      if (error.stack) {
        console.error(`Error stack: ${error.stack}`);
      }
      
      // Send error response
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false, 
        error: error.message || 'Unknown error' 
      }));
    }
  } else {
    // Simple index page for manual testing
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Debug PartyKit</title>
        </head>
        <body>
          <h1>Debug PartyKit</h1>
          <button id="testBtn">Test Fetch to Research Worker</button>
          <pre id="result" style="margin-top: 20px; padding: 10px; background: #f0f0f0;"></pre>
          
          <script>
            document.getElementById('testBtn').addEventListener('click', async () => {
              try {
                const result = document.getElementById('result');
                result.textContent = 'Sending request...';
                
                const response = await fetch('/test', {
                  method: 'POST'
                });
                
                const data = await response.json();
                result.textContent = JSON.stringify(data, null, 2);
              } catch (err) {
                document.getElementById('result').textContent = 'Error: ' + err.message;
              }
            });
          </script>
        </body>
      </html>
    `);
  }
});

// Start the server
const PORT = 9876;
server.listen(PORT, () => {
  console.log(`Debug server running at http://localhost:${PORT}`);
  console.log(`Test the fetch by navigating to this URL and clicking the button`);
  console.log(`Or send a POST request to http://localhost:${PORT}/test`);
}); 