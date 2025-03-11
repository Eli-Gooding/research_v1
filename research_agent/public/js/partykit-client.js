/**
 * PartyKit Client
 * 
 * This script provides client-side functionality to interact with the PartyKit server.
 * It handles:
 * - URL submission
 * - Task status checking
 * - Report retrieval
 */

// Configuration
const PARTYKIT_HOST = window.location.hostname === 'localhost' ? 
  `${window.location.hostname}:1999` : 
  'your-partykit-app.username.partykit.dev';

// Main PartyKit client class
class ResearchClient {
  constructor() {
    // Base URL for API requests
    this.baseUrl = window.location.origin;
    
    // Initialize the UI
    this.initUI();
  }

  // Initialize the UI elements
  initUI() {
    // ... existing code ...
  }

  /**
   * Submit a URL for scraping
   * @param {string} url - The URL to scrape
   * @returns {Promise<Object>} - The response from the server
   */
  async submitUrl(url) {
    try {
      const response = await fetch(`${this.baseUrl}/scrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error submitting URL:', error);
      throw error;
    }
  }

  /**
   * Check the status of a task
   * @param {string} taskId - The ID of the task to check
   * @returns {Promise<Object>} - The task status
   */
  async checkTaskStatus(taskId) {
    try {
      const response = await fetch(`${this.baseUrl}/task/${taskId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error checking task status:', error);
      throw error;
    }
  }

  /**
   * Get a report
   * @param {string} reportId - The ID of the report to retrieve
   * @returns {Promise<Object>} - The report data
   */
  async getReport(reportId) {
    try {
      const response = await fetch(`${this.baseUrl}/report/${reportId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting report:', error);
      throw error;
    }
  }

  /**
   * Get a detailed analysis report
   * @param {string} reportId - The ID of the report to retrieve
   * @returns {Promise<Object>} - The analysis report data
   */
  async getAnalysisReport(reportId) {
    try {
      const response = await fetch(`${this.baseUrl}/analysis-report/${reportId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting analysis report:', error);
      throw error;
    }
  }

  /**
   * Trigger detailed analysis for a task
   * @param {string} taskId - The ID of the task to analyze
   * @returns {Promise<Object>} - The response from the server
   */
  async triggerAnalysis(taskId) {
    try {
      const response = await fetch(`${this.baseUrl}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskId }),
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error triggering analysis:', error);
      throw error;
    }
  }

  /**
   * Check the status of an analysis task
   * @param {string} taskId - The ID of the task to check
   * @returns {Promise<Object>} - The analysis task status
   */
  async checkAnalysisStatus(taskId) {
    try {
      const response = await fetch(`${this.baseUrl}/analysis-status/${taskId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error checking analysis status:', error);
      throw error;
    }
  }

  /**
   * Start polling for task status updates
   * @param {string} taskId - The ID of the task to poll
   * @param {Function} callback - The callback to call with the status
   * @param {number} interval - The polling interval in milliseconds
   */
  startStatusPolling(taskId, callback, interval = 2000) {
    // Clear any existing interval
    this.stopStatusPolling();

    // Start polling
    this.statusCheckInterval = setInterval(async () => {
      try {
        const status = await this.checkTaskStatus(taskId);
        callback(status);

        // If the task is completed or failed, stop polling
        if (['completed', 'report_generated', 'error'].includes(status.status)) {
          this.stopStatusPolling();
        }
      } catch (error) {
        console.error('Error polling task status:', error);
        this.stopStatusPolling();
      }
    }, interval);
  }

  /**
   * Stop polling for task status updates
   */
  stopStatusPolling() {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }
  }

  /**
   * Start polling for analysis status updates
   * @param {string} taskId - The ID of the task to poll
   * @param {Function} callback - The callback to call with the status
   * @param {number} interval - The polling interval in milliseconds
   */
  startAnalysisPolling(taskId, callback, interval = 2000) {
    // Clear any existing interval
    this.stopAnalysisPolling();

    // Start polling
    this.analysisCheckInterval = setInterval(async () => {
      try {
        const status = await this.checkAnalysisStatus(taskId);
        callback(status);

        // If the analysis is completed or failed, stop polling
        if (['completed', 'error'].includes(status.status)) {
          this.stopAnalysisPolling();
        }
      } catch (error) {
        console.error('Error polling analysis status:', error);
        this.stopAnalysisPolling();
      }
    }, interval);
  }

  /**
   * Stop polling for analysis status updates
   */
  stopAnalysisPolling() {
    if (this.analysisCheckInterval) {
      clearInterval(this.analysisCheckInterval);
      this.analysisCheckInterval = null;
    }
  }
}

// Initialize the client when the page loads
window.addEventListener('DOMContentLoaded', () => {
  window.researchClient = new ResearchClient();
}); 