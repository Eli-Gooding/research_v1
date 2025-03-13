/**
 * Initialization script for the Company Research Agent
 * 
 * This script:
 * 1. Checks environment variables
 * 2. Creates necessary directories
 * 3. Sets up default configurations
 * 4. Provides instructions to start the system
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Check if a file exists
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (error) {
    return false;
  }
}

// Create directory if it doesn't exist
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
}

// Check if we have the required environment files
function checkEnvironmentFiles() {
  const devVarsPath = path.join(__dirname, '.dev.vars');
  const partyEnvPath = path.join(__dirname, '.env.party');

  if (!fileExists(devVarsPath)) {
    console.log('❌ Missing .dev.vars file for Cloudflare Workers');
    console.log('Please create it with the required environment variables.');
    console.log('You can use the template provided in the README.');
    return false;
  }

  if (!fileExists(partyEnvPath)) {
    console.log('❌ Missing .env.party file for PartyKit');
    console.log('Please create it with the required environment variables.');
    console.log('You can use the template provided in the README.');
    return false;
  }

  return true;
}

// Check if the required API keys are set
function checkApiKeys() {
  let hasErrors = false;

  // Check .dev.vars
  if (fileExists(path.join(__dirname, '.dev.vars'))) {
    const devVars = fs.readFileSync(path.join(__dirname, '.dev.vars'), 'utf8');
    
    if (!devVars.includes('OPENAI_API_KEY=') || devVars.includes('OPENAI_API_KEY=sk-your-openai-key')) {
      console.log('❌ OPENAI_API_KEY not set in .dev.vars');
      hasErrors = true;
    }
  }

  // Check .env.party
  if (fileExists(path.join(__dirname, '.env.party'))) {
    const partyEnv = fs.readFileSync(path.join(__dirname, '.env.party'), 'utf8');
    
    if (!partyEnv.includes('OPENAI_API_KEY=') || partyEnv.includes('OPENAI_API_KEY=sk-your-openai-key-here')) {
      console.log('❌ OPENAI_API_KEY not set in .env.party');
      hasErrors = true;
    }
  }

  return !hasErrors;
}

// Create necessary directories for data
function createDirectories() {
  ensureDir(path.join(__dirname, 'data'));
  ensureDir(path.join(__dirname, 'data', 'jobs'));
}

// Run the system checks
function runSystemChecks() {
  console.log('🔍 Checking system requirements...');
  
  let allChecksPass = true;
  
  // Check Node.js version
  const nodeVersion = process.version;
  console.log(`Node.js version: ${nodeVersion}`);
  
  if (!nodeVersion.startsWith('v18.') && !nodeVersion.startsWith('v20.')) {
    console.log('⚠️ Warning: Recommended Node.js version is 18.x or 20.x');
  }
  
  // Check npm installed
  try {
    const npmVersion = execSync('npm --version').toString().trim();
    console.log(`npm version: ${npmVersion}`);
  } catch (error) {
    console.log('❌ npm not found. Please install npm.');
    allChecksPass = false;
  }
  
  // Check for required packages
  const packageJsonPath = path.join(__dirname, 'package.json');
  if (!fileExists(packageJsonPath)) {
    console.log('❌ package.json not found');
    allChecksPass = false;
  } else {
    // Check if dependencies are installed
    const nodeModulesPath = path.join(__dirname, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      console.log('⚠️ Node modules not installed. Running npm install...');
      try {
        execSync('npm install', { cwd: __dirname });
        console.log('✅ Dependencies installed successfully');
      } catch (error) {
        console.log('❌ Error installing dependencies:', error.message);
        allChecksPass = false;
      }
    } else {
      console.log('✅ Dependencies already installed');
    }
  }
  
  // Check environment files
  if (checkEnvironmentFiles()) {
    console.log('✅ Environment files exist');
  } else {
    allChecksPass = false;
  }
  
  // Check API keys
  if (checkApiKeys()) {
    console.log('✅ API keys are set');
  } else {
    allChecksPass = false;
  }
  
  return allChecksPass;
}

// Print instructions on how to start the system
function printStartInstructions() {
  console.log('\n📋 To start the system:');
  console.log('1. Run the development server:');
  console.log('   npm run dev');
  console.log('\n   This will start:');
  console.log('   - Cloudflare Workers on http://localhost:8787');
  console.log('   - PartyKit server on http://localhost:1999');
  console.log('   - Static file server on http://localhost:3000');
  console.log('\n2. Open http://localhost:3000 in your browser');
  console.log('\n3. Enter a company name to research and click "Research"');
  console.log('\n4. To deploy to production:');
  console.log('   npm run deploy');
}

// Main function
function main() {
  console.log('🚀 Initializing Company Research Agent...');
  
  const allChecksPass = runSystemChecks();
  
  createDirectories();
  
  console.log('\n' + (allChecksPass ? '✅ All checks passed!' : '⚠️ Some checks failed. Please fix the issues above.'));
  
  printStartInstructions();
}

// Run the main function
main(); 