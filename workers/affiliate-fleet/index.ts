import { withRetry } from '../../shared/retry';

export interface Env {
  CAPITAL_DB: D1Database;
  CAPITAL_KV: KVNamespace;
  TWITTER_API_KEY: string;
  TWITTER_API_SECRET: string;
  TWITTER_ACCESS_TOKEN: string;
  TWITTER_ACCESS_SECRET: string;
  COINREBATE_API_KEY: string;
  DISCORD_WEBHOOK: string;
}

interface AffiliateProgram {
  id: string;
  name: string;
  platform: string;
  referral_link: string;
  commission_bps: number;
  cookie_days: number;
  active: boolean;
  config?: any;
}

interface AffiliateBot {
  id: string;
  program_id: string;
  platform: string;
  handle?: string;
  strategy: string;
  posts_per_day: number;
  active: boolean;
  config?: any;
}

const ENGAGEMENT_STRATEGIES = {
  twitter_search: {
    keywords: ['need help fundraising', 'looking for investors', 'crowdfunding', 'startup funding'],
    actions: ['reply', 'like', 'follow'],
  },
  twitter_trending: {
    topics: ['crypto', 'defi', 'web3', 'fundraising', 'blockchain'],
    actions: ['quote_tweet', 'reply'],
  },
  discord_crypto: {
    servers: ['crypto-trading', 'defi-yield', 'web3-builders'],
    actions: ['message', 'dm'],
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === '/programs') {
        const programs = await env.CAPITAL_DB.prepare(
          'SELECT * FROM affiliate_programs WHERE active = 1 ORDER BY commission_bps DESC'
        ).all();
        return new Response(JSON.stringify({ programs: programs.results }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/program' && method === 'POST') {
        const body = await request.json() as any;
        const program = await addProgram(env, body);
        return new Response(JSON.stringify({ program }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/bots') {
        const bots = await env.CAPITAL_DB.prepare(
          'SELECT * FROM affiliate_bots WHERE active = 1'
        ).all();
        return new Response(JSON.stringify({ bots: bots.results }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/engage') {
        const result = await runEngagement(env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/stats') {
        const stats = await getAffiliateStats(env);
        return new Response(JSON.stringify(stats), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response('Affiliate Fleet', { status: 200 });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await runEngagement(env);
  },
};

async function addProgram(env: Env, data: any): Promise<AffiliateProgram> {
  const id = crypto.randomUUID();
  const program: AffiliateProgram = {
    id,
    name: data.name,
    platform: data.platform,
    referral_link: data.referral_link,
    commission_bps: data.commission_bps,
    cookie_days: data.cookie_days || 30,
    active: true,
    config: data.config || {},
  };

  await env.CAPITAL_DB.prepare(
    `INSERT INTO affiliate_programs (id, name, platform, referral_link, commission_bps, cookie_days, active, config, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).bind(
    program.id, program.name, program.platform, program.referral_link,
    program.commission_bps, program.cookie_days,
    JSON.stringify(program.config), Date.now()
  ).run();

  return program;
}

async function runEngagement(env: Env): Promise<any> {
  const bots = await env.CAPITAL_DB.prepare(
    'SELECT * FROM affiliate_bots WHERE active = 1'
  ).all() as any;

  const programs = await env.CAPITAL_DB.prepare(
    'SELECT * FROM affiliate_programs WHERE active = 1'
  ).all() as any;

  const results: any[] = [];

  for (const bot of (bots.results || [])) {
    try {
      const program = (programs.results || []).find((p: any) => p.id === bot.program_id);
      if (!program) continue;

      const strategy = ENGAGEMENT_STRATEGIES[bot.strategy as keyof typeof ENGAGEMENT_STRATEGIES];
      if (!strategy) continue;

      const engagements = await executeStrategy(env, bot, program, strategy);
      results.push({ botId: bot.id, platform: bot.platform, engagements });

      for (const eng of engagements) {
        await env.CAPITAL_DB.prepare(
          `INSERT INTO affiliate_clicks (id, program_id, source, channel, clicked_at)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), program.id, bot.platform, bot.strategy, Date.now()).run();
      }
    } catch (error: any) {
      results.push({ botId: bot.id, error: error.message });
    }
  }

  return { timestamp: Date.now(), results };
}

async function executeStrategy(env: Env, bot: any, program: any, strategy: any): Promise<any[]> {
  const engagements: any[] = [];
  const maxPerRun = Math.ceil(bot.posts_per_day / 24);

  for (const keyword of strategy.keywords.slice(0, maxPerRun)) {
    switch (bot.platform) {
      case 'twitter':
        const tweetEng = await searchAndEngageTwitter(env, keyword, program);
        engagements.push(...tweetEng);
        break;
      case 'discord':
        // Placeholder
        engagements.push({ platform: 'discord', keyword, status: 'simulated' });
        break;
      default:
        engagements.push({ platform: bot.platform, keyword, status: 'unsupported' });
    }
  }

  return engagements;
}

async function searchAndEngageTwitter(env: Env, keyword: string, program: any): Promise<any[]> {
  const engagements: any[] = [];

  try {
    const token = await getTwitterToken(env);
    const searchUrl = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(keyword)}&max_results=10&expansions=author_id`;

    const response = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (response.status === 429) {
      console.warn(`[Twitter] Rate limited on search for keyword: ${keyword}`);
      return engagements;
    }

    if (!response.ok) return engagements;

    const data = await response.json() as any;
    const tweets = data.data || [];

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      const replyText = generateReferralMessage(program, keyword, i);

      try {
        const replyResponse = await withRetry(async () => {
          const oauthHeader = await generateOAuth1Header(
            'POST',
            'https://api.twitter.com/2/tweets',
            {},
            env.TWITTER_API_KEY,
            env.TWITTER_API_SECRET,
            env.TWITTER_ACCESS_TOKEN,
            env.TWITTER_ACCESS_SECRET,
          );

          const res = await fetch('https://api.twitter.com/2/tweets', {
            method: 'POST',
            headers: {
              'Authorization': oauthHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text: replyText,
              reply: { in_reply_to_tweet_id: tweet.id },
            }),
          });

          if (res.status === 429) {
            console.warn(`[Twitter] Rate limited on reply to tweet ${tweet.id}`);
            return res;
          }

          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Twitter reply failed: ${res.status} ${errBody}`);
          }

          return res;
        }, { maxAttempts: 3, baseDelayMs: 2000 });

        if (replyResponse.ok) {
          const replyData = await replyResponse.json() as any;
          engagements.push({
            tweetId: tweet.id,
            replyId: replyData.data?.id,
            action: 'reply',
            keyword,
            status: 'success',
          });
        } else if (replyResponse.status === 429) {
          engagements.push({
            tweetId: tweet.id,
            action: 'reply',
            keyword,
            status: 'rate_limited',
          });
        }
      } catch (error: any) {
        console.warn(`[Twitter] Failed to reply to tweet ${tweet.id}: ${error.message}`);
        engagements.push({
          tweetId: tweet.id,
          action: 'reply',
          keyword,
          status: 'failed',
          error: error.message,
        });
      }
    }
  } catch (error: any) {
    console.warn(`[Twitter] Search failed for keyword ${keyword}: ${error.message}`);
  }

  return engagements;
}

function generateReferralMessage(program: any, keyword?: string, index?: number): string {
  const templates = [
    `Love that you're exploring ${keyword || 'funding options'}! ${program.name} helps you earn crypto back — ${program.referral_link}`,
    `Great point about ${keyword || 'trading'}! Check out ${program.name} for cashback on trades: ${program.referral_link}`,
    `Solid thread! Btw, ${program.name} gives rebates on every trade. Worth a look: ${program.referral_link}`,
    `Totally agree! ${program.name} has been a game-changer — earn while you trade: ${program.referral_link}`,
    `Have you tried ${program.name}? Get paid to trade, perfect for ${keyword || 'crypto'}: ${program.referral_link}`,
  ];
  const idx = index !== undefined ? index % templates.length : Math.floor(Math.random() * templates.length);
  return templates[idx];
}

async function getTwitterToken(env: Env): Promise<string> {
  const cached = await env.CAPITAL_KV.get('twitter_token');
  if (cached) return cached;

  const credentials = `${env.TWITTER_API_KEY}:${env.TWITTER_API_SECRET}`;
  const encoded = btoa(credentials);

  const response = await fetch('https://api.twitter.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${encoded}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error(`Twitter token request failed: ${response.status}`);
  }

  const data = await response.json() as any;
  if (!data.access_token) {
    throw new Error('Twitter token response missing access_token');
  }

  await env.CAPITAL_KV.put('twitter_token', data.access_token, { expirationTtl: 7200 });
  return data.access_token;
}

async function generateOAuth1Header(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  token: string,
  tokenSecret: string,
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: token,
    oauth_version: '1.0',
  };

  const allParams = { ...params, ...oauthParams };
  const paramString = Object.keys(allParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const signatureBaseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signatureBaseString));
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

  oauthParams.oauth_signature = signatureBase64;

  return 'OAuth ' + Object.keys(oauthParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');
}

async function getAffiliateStats(env: Env): Promise<any> {
  const clicks = await env.CAPITAL_DB.prepare('SELECT COUNT(*) as count, source FROM affiliate_clicks GROUP BY source').all();
  const commissions = await env.CAPITAL_DB.prepare(
    "SELECT SUM(CAST(amount AS REAL)) as total FROM affiliate_commissions WHERE status = 'paid'"
  ).first();
  const programs = await env.CAPITAL_DB.prepare(
    'SELECT COUNT(*) as count FROM affiliate_programs WHERE active = 1'
  ).first();

  return {
    totalClicks: (clicks.results || []).reduce((sum: number, c: any) => sum + c.count, 0),
    bySource: clicks.results || [],
    totalEarned: commissions?.total || 0,
    activePrograms: programs?.count || 0,
  };
}
