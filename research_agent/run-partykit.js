#!/usr/bin/env node

/**
 * PartyKit Server Management Script
 * 
 * This script starts and manages the PartyKit server.
 * It handles graceful shutdown when terminated.
 */

const { spawn } = require('child_process');
const readline = require('readline');
const { exec } = require('child_process');

// Configuration
const PARTYKIT_PORT = 1999;
let server = null;
let shuttingDown = false;

// Set up readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Kill any processes running on a specific port
 * @param {number} port - The port to free up
 * @returns {Promise<void>}
 */
async function killProcessOnPort(port) {
  return new Promise((resolve) => {
    // Different command for different OS
    const command = process.platform === 'win32'
      ? `netstat -ano | findstr :${port} | findstr LISTENING`
      : `lsof -i :${port} | grep LISTEN | awk '{print $2}'`;
    
    exec(command, (error, stdout) => {
      if (error || !stdout) {
        // No process found on this port
        resolve();
        return;
      }
      
      // Extract PID
      let pid;
      if (process.platform === 'win32') {
        pid = stdout.split('\r\n')[0].trim().split(/\s+/).pop();
      } else {
        pid = stdout.trim();
      }
      
      if (pid) {
        console.log(`Killing process ${pid} on port ${port}`);
        try {
          process.platform === 'win32'
            ? exec(`taskkill /F /PID ${pid}`)
            : exec(`kill -9 ${pid}`);
        } catch (e) {
          console.error(`Failed to kill process: ${e.message}`);
        }
      }
      
      // Give it a moment to release the port
      setTimeout(resolve, 1000);
    });
  });
}

/**
 * Start the PartyKit server
 * @returns {ChildProcess} - The spawned server process
 */
function startServer() {
  console.log(`Starting PartyKit server on port ${PARTYKIT_PORT}...`);
  
  const serverProcess = spawn('npx', ['partykit', 'dev', '--port', PARTYKIT_PORT, '--verbose'], {
    stdio: 'pipe',
    shell: true,
    env: {
      ...process.env,
      NODE_OPTIONS: '--experimental-specifier-resolution=node'
    }
  });
  
  serverProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`[PartyKit] ${output}`);
    
    // Check if the server is ready
    if (output.includes('Server running at')) {
      console.log(`\n✅ PartyKit server is now running on port ${PARTYKIT_PORT}\n`);
    }
  });
  
  serverProcess.stderr.on('data', (data) => {
    console.error(`[PartyKit ERROR] ${data.toString()}`);
  });
  
  serverProcess.on('close', (code) => {
    if (!shuttingDown) {
      console.log(`\n⚠️ PartyKit server exited with code ${code}.`);
    } else {
      console.log(`\n🛑 PartyKit server shut down.`);
    }
  });
  
  return serverProcess;
}

/**
 * Gracefully shut down the server
 */
function shutdownServer() {
  if (shuttingDown) return;
  
  shuttingDown = true;
  console.log('\n🛑 Shutting down PartyKit server...');
  
  if (server && !server.killed) {
    server.kill('SIGINT');
  }
  
  rl.close();
  
  // Force exit after a timeout in case the process doesn't terminate
  setTimeout(() => {
    console.log('👋 PartyKit server shut down. Goodbye!');
    process.exit(0);
  }, 3000);
}

/**
 * Start the PartyKit server
 */
async function startPartyKit() {
  console.log('🚀 Starting PartyKit Server...\n');
  
  // Kill any processes that might be using our port
  await killProcessOnPort(PARTYKIT_PORT);
  
  // Start the server
  server = startServer();
}

// Start the server
startPartyKit();

// Display help message
console.log('\n📋 Commands:');
console.log('  r - Restart the server');
console.log('  q - Quit and shut down the server');
console.log('  h - Show this help message\n');

// Handle user input
rl.on('line', (input) => {
  switch (input.trim().toLowerCase()) {
    case 'r':
      console.log('\n🔄 Restarting PartyKit server...');
      shuttingDown = true;
      
      if (server && !server.killed) {
        server.kill('SIGINT');
      }
      
      // Wait a bit before restarting
      setTimeout(() => {
        shuttingDown = false;
        startPartyKit();
      }, 3000);
      break;
      
    case 'q':
      shutdownServer();
      break;
      
    case 'h':
      console.log('\n📋 Commands:');
      console.log('  r - Restart the server');
      console.log('  q - Quit and shut down the server');
      console.log('  h - Show this help message\n');
      break;
      
    default:
      console.log('\n❓ Unknown command. Type "h" for help.\n');
  }
});

// Handle process termination
process.on('SIGINT', shutdownServer);
process.on('SIGTERM', shutdownServer);

console.log('⌛ Starting PartyKit server, please wait...'); 