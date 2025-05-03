// src/main.ts
import * as dotenv from 'dotenv';
import { RedditMonitorService } from './services/reddit-monitor-service';
// Load environment variables
dotenv.config();

// Function to validate required environment variables
function validateEnv(): boolean {
  const requiredVars = [
    'REDDIT_CLIENT_ID',
    'REDDIT_CLIENT_SECRET',
    'REDDIT_REDIRECT_URI'
  ];
  
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please check your .env file');
    return false;
  }
  
  return true;
}

// Custom handler for found posts (optional)
function handleMatchedPost(post: any, matchedKeywords: string[]): void {
  console.log(`[${new Date().toISOString()}] Match found: "${post.data.title}"`);
  console.log(`Keywords: ${matchedKeywords.join(', ')}`);
  console.log(`URL: https://reddit.com${post.data.permalink}`);
}

// Main function to start the application
async function main(): Promise<void> {
  // Validate environment variables
  if (!validateEnv()) {
    process.exit(1);
  }
  
  // Create monitor configuration
  const config = {
    subreddit: process.env.SUBREDDIT || 'travel',
    checkInterval: process.env.CHECK_INTERVAL || '*/15 * * * *',
    keywords: (process.env.KEYWORDS || 'travel,planning,app').split(','),
    clientId: process.env.REDDIT_CLIENT_ID!,
    clientSecret: process.env.REDDIT_CLIENT_SECRET!,
    redirectUri: process.env.REDDIT_REDIRECT_URI!,
    userAgent: process.env.USER_AGENT || 'RedditMonitor/1.0 by YourName',
    onMatchFound: handleMatchedPost
  };
  
  // Create the monitor service
  const monitor = new RedditMonitorService(config);
  
  try {
    // Start authorization process
    console.log('Starting authorization process...');
    await monitor.authorize();
    
    // Start monitoring
    await monitor.start();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('Shutting down...');
      monitor.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('Error starting monitor:', error);
    process.exit(1);
  }
  
  // Error handling for the process
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    monitor.stop();
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
  });
}

// Run the application
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// ##WHERE I AM LEAVING OFF:
// all code is compiling
// have not run anything
//have not put credentials into .env for reddit
//see "Monitor Travel Planning App" convo