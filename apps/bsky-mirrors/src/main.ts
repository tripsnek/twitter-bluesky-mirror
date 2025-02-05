import * as dotenv from 'dotenv';
import { CrossPostAgent } from './cross-post-agent';
import { AgentConfig } from './types';

dotenv.config();

const urlPre = CrossPostAgent.SCRAPE_SOURCE == 'nitter' ? 'https://nitter.net' : 'https://x.com';

interface BlueskyCredentials {
  identifier: string;
  password: string;
}

interface AccountPair {
  twitter: string;
  bluesky: BlueskyCredentials;
  storageDir: string;
}

const agentConfig: AgentConfig = {
  accountPairs: loadMirrorConfigurations(),
  CHECK_INTERVAL_MS: 10 * 60 * 1000, // 10 minutes
};

function loadMirrorConfigurations(): AccountPair[] {
  const pairs: AccountPair[] = [];
  let configIndex = 1;

  while (true) {
    const twitterId = process.env[`MIRROR_${configIndex}_TWITTER_IDENTIFIER`];
    const blueskyId = process.env[`MIRROR_${configIndex}_BLUESKY_IDENTIFIER`];
    const blueskyPassword = process.env[`MIRROR_${configIndex}_BLUESKY_PASSWORD`];

    // If we don't find a configuration for this index, we're done
    if (!twitterId || !blueskyId || !blueskyPassword) {
      break;
    }

    pairs.push({
      twitter: `${urlPre}/${twitterId}`,
      bluesky: {
        identifier: blueskyId,
        password: blueskyPassword,
      },
      storageDir: `./storage/${twitterId.toLowerCase()}`
    });

    configIndex++;
  }

  return pairs;
}

const agent = new CrossPostAgent(agentConfig);

process.on('SIGINT', async () => {
  console.log('Cleaning up...');
  await agent.cleanup();
  process.exit(0);
});

agent.start().catch(console.error);

