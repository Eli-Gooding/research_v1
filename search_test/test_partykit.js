import fetch from 'node-fetch';

// Direct test for PartyKit server

// Function to send a message to the PartyKit server
async function testPartyKitServer() {
  console.log('Testing PartyKit server');
  
  try {
    // Start a research job via the PartyKit server
    console.log('Sending startResearch message to PartyKit server');
    
    const response = await fetch('http://localhost:1999/party/searchagent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'startResearch',
        jobId: 'test-party-' + Date.now(),
        companyName: 'TestCompany',
        officialWebsite: 'testcompany.com',
        categories: ['overview', 'products']
      })
    });
    
    if (!response.ok) {
      console.error(`Error response from PartyKit server: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      return;
    }
    
    const data = await response.json();
    console.log('PartyKit server response:', data);
    
    // Wait a bit to see the log output
    console.log('Check the console logs for both the PartyKit server and the research worker');
    console.log('The PartyKit server should dispatch research tasks to the worker');
    
  } catch (error) {
    console.error('Error testing PartyKit server:', error);
  }
}

// Run the test
testPartyKitServer().catch(console.error); 