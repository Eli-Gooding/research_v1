#!/usr/bin/env node

/**
 * Worker Management Script
 * 
 * This script starts and manages both the main worker and the detailed analysis worker.
 * It handles graceful shutdown of all processes when terminated.
 */

const { spawn } = require('child_process');
const readline = require('readline');
const { exec } = require('child_process');

// Configuration
const MAIN_WORKER_PORT = 8787;
const ANALYSIS_WORKER_PORT = 8788;
const workers = [];
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
 * Start a worker process
 * @param {string} name - Name of the worker
 * @param {string} script - Path to the worker script
 * @param {number} port - Port to run the worker on
 * @returns {ChildProcess} - The spawned worker process
 */
function startWorker(name, script, port) {
  console.log(`Starting ${name} on port ${port}...`);
  
  const worker = spawn('npx', ['wrangler', 'dev', script, '--port', port], {
    stdio: 'pipe',
    shell: true
  });
  
  worker.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`[${name}] ${output}`);
    
    // Check if the worker is ready
    if (output.includes('Ready on http://localhost')) {
      console.log(`\n✅ ${name} is now running on port ${port}\n`);
    }
  });
  
  worker.stderr.on('data', (data) => {
    console.error(`[${name} ERROR] ${data.toString()}`);
  });
  
  worker.on('close', (code) => {
    if (!shuttingDown) {
      console.log(`\n⚠️ ${name} exited with code ${code}.`);
      
      // Don't restart automatically if there's a port conflict
      if (code === 1 && workers.includes(worker)) {
        const workerIndex = workers.indexOf(worker);
        if (workerIndex !== -1) {
          workers.splice(workerIndex, 1);
        }
      }
    } else {
      console.log(`\n🛑 ${name} shut down.`);
    }
  });
  
  return worker;
}

/**
 * Gracefully shut down all workers
 */
function shutdownWorkers() {
  if (shuttingDown) return;
  
  shuttingDown = true;
  console.log('\n🛑 Shutting down all workers...');
  
  workers.forEach(worker => {
    if (worker && !worker.killed) {
      worker.kill('SIGINT');
    }
  });
  
  rl.close();
  
  // Force exit after a timeout in case some processes don't terminate
  setTimeout(() => {
    console.log('👋 All workers shut down. Goodbye!');
    process.exit(0);
  }, 3000);
}

/**
 * Start all workers with proper sequencing
 */
async function startAllWorkers() {
  console.log('🚀 Starting Research Agent Workers...\n');
  
  // Kill any processes that might be using our ports
  await killProcessOnPort(MAIN_WORKER_PORT);
  await killProcessOnPort(ANALYSIS_WORKER_PORT);
  
  // Start the analysis worker first
  workers.push(startWorker('Analysis Worker', 'src/workers/detailed-analysis.ts', ANALYSIS_WORKER_PORT));
  
  // Wait a bit before starting the main worker
  setTimeout(() => {
    workers.push(startWorker('Main Worker', 'src/index.ts', MAIN_WORKER_PORT));
  }, 5000);
}

// Start the workers
startAllWorkers();

// Display help message
console.log('\n📋 Commands:');
console.log('  r - Restart all workers');
console.log('  q - Quit and shut down all workers');
console.log('  h - Show this help message\n');

// Handle user input
rl.on('line', (input) => {
  switch (input.trim().toLowerCase()) {
    case 'r':
      console.log('\n🔄 Restarting all workers...');
      shuttingDown = true;
      workers.forEach(worker => {
        if (worker && !worker.killed) {
          worker.kill('SIGINT');
        }
      });
      
      // Clear workers array
      workers.length = 0;
      
      // Wait a bit before restarting
      setTimeout(() => {
        shuttingDown = false;
        startAllWorkers();
      }, 3000);
      break;
      
    case 'q':
      shutdownWorkers();
      break;
      
    case 'h':
      console.log('\n📋 Commands:');
      console.log('  r - Restart all workers');
      console.log('  q - Quit and shut down all workers');
      console.log('  h - Show this help message\n');
      break;
      
    default:
      console.log('\n❓ Unknown command. Type "h" for help.\n');
  }
});

// Handle process termination
process.on('SIGINT', shutdownWorkers);
process.on('SIGTERM', shutdownWorkers);

console.log('⌛ Starting workers, please wait...'); 