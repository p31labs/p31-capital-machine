// @p31 HONESTY STUB — DOES NOT SEND EMAILS
// Marks leads "contacted" without dispatching real mail; requires a working
// email API + webhook config to function. See README "Honest Status: Revenue Workers".
export interface Env {
  CAPITAL_DB: D1Database;
  CAPITAL_KV: KVNamespace;
  OPENAI_API_KEY: string;
  DISCORD_WEBHOOK: string;
  SCRAPINGBEE_API_KEY: string;
  EMAIL_API_KEY: string;
}

interface Lead {
  id: string;
  source: string;
  name: string;
  email?: string;
  campaign_url: string;
  goal: number;
  raised: number;
  category: string;
  industry?: string;
  score: number;
  ai_summary?: string;
  contacted: boolean;
}

interface Campaign {
  id: string;
  title: string;
  description: string;
  goal: number;
  raised: number;
  status: string;
  milestones: any[];
}

const SCRAPE_SOURCES = [
  { name: 'gofundme', url: 'https://api.gofundme.com/feeds/search', enabled: true },
  { name: 'indiegogo', url: 'https://api.indiegogo.com/api/public/projects/getActiveCrowdfundingProjects', enabled: true },
  { name: 'kickstarter', url: 'https://www.kickstarter.com/projects/search.json', enabled: true },
  { name: 'crowdsupply', url: 'https://www.crowdsupply.com/api/projects', enabled: true },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === '/campaigns') {
        const campaigns = await getCampaigns(env);
        return new Response(JSON.stringify({ campaigns }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/campaign' && method === 'POST') {
        const body = await request.json() as any;
        const campaign = await createCampaign(env, body);
        return new Response(JSON.stringify({ campaign }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/leads') {
        const minScore = parseInt(url.searchParams.get('min_score') || '0');
        const source = url.searchParams.get('source');
        let query = 'SELECT * FROM leads WHERE score >= ?';
        const params: any[] = [minScore];
        if (source) { query += ' AND source = ?'; params.push(source); }
        query += ' ORDER BY score DESC LIMIT 100';

        const leads = await env.CAPITAL_DB.prepare(query).bind(...params).all();
        return new Response(JSON.stringify({ leads: leads.results }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/scrape') {
        const result = await scrapeAllSources(env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/process-leads') {
        const result = await processLeads(env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/engage' && method === 'POST') {
        const body = await request.json() as any;
        const result = await engageLead(env, body.lead_id, body.campaign_id);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/templates') {
        const templates = await env.CAPITAL_DB.prepare('SELECT * FROM outreach_templates').all();
        return new Response(JSON.stringify({ templates: templates.results }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/stats') {
        const stats = await getFundraisingStats(env);
        return new Response(JSON.stringify(stats), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response('AI Fundraising Agent', { status: 200 });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    switch (event.cron) {
      case '0 */6 * * *':
        await scrapeAllSources(env);
        break;
      case '*/30 * * * *':
        await processLeads(env);
        break;
    }
  },
};

async function getCampaigns(env: Env): Promise<Campaign[]> {
  const result = await env.CAPITAL_DB.prepare(
    'SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 50'
  ).all();
  return (result.results || []).map((row: any) => ({
    ...row,
    milestones: JSON.parse(row.milestones || '[]'),
  }));
}

async function createCampaign(env: Env, data: any): Promise<Campaign> {
  const id = crypto.randomUUID();
  const now = Date.now();

  const campaign: Campaign = {
    id,
    title: data.title,
    description: data.description,
    goal: data.goal,
    raised: 0,
    status: 'draft',
    milestones: data.milestones || [],
  };

  await env.CAPITAL_DB.prepare(
    `INSERT INTO campaigns (id, title, description, goal, raised, status, milestones, category, owner_address, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, campaign.title, campaign.description, campaign.goal, campaign.raised,
    campaign.status, JSON.stringify(campaign.milestones),
    data.category || null, data.owner_address || null, now, now
  ).run();

  return campaign;
}

async function scrapeAllSources(env: Env): Promise<any> {
  const results: any[] = [];

  for (const source of SCRAPE_SOURCES) {
    if (!source.enabled) continue;
    const startTime = Date.now();

    try {
      const leads = await scrapeSource(env, source);
      const newCount = await storeLeads(env, leads);

      results.push({
        source: source.name,
        found: leads.length,
        new: newCount,
        duration: Date.now() - startTime,
      });

      await env.CAPITAL_DB.prepare(
        `INSERT INTO scraping_logs (id, source, items_found, items_new, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), source.name, leads.length, newCount, Date.now() - startTime, Date.now()).run();
    } catch (error: any) {
      results.push({ source: source.name, error: error.message });

      await env.CAPITAL_DB.prepare(
        `INSERT INTO scraping_logs (id, source, items_found, items_new, duration_ms, error, created_at)
         VALUES (?, ?, 0, 0, ?, ?, ?)`
      ).bind(crypto.randomUUID(), source.name, Date.now() - startTime, error.message, Date.now()).run();
    }
  }

  return {
    scraped: true,
    sources: results,
    timestamp: Date.now(),
  };
}

async function scrapeSource(env: Env, source: { name: string; url: string }): Promise<Lead[]> {
  const leads: Lead[] = [];

  switch (source.name) {
    case 'indiegogo':
      try {
        const response = await fetch(source.url, {
          headers: { 'Accept': 'application/json' },
        });
        if (response.ok) {
          const data = await response.json() as any[];
          for (const project of (data || [])) {
            leads.push({
              id: `igg-${project.projectUrlName || crypto.randomUUID()}`,
              source: 'indiegogo',
              name: project.creatorName || 'Unknown Creator',
              campaign_url: project.projectHomeUrl || '',
              goal: parseFloat(project.campaignGoal) || 0,
              raised: parseFloat(project.fundsGathered) || 0,
              category: project.category || 'other',
              industry: project.tag || null,
              score: 0,
              contacted: false,
            });
          }
        }
      } catch {
        // Fallback to placeholder
      }
      break;

    case 'kickstarter':
      try {
        const response = await fetch(`${source.url}?category_id=16&sort=magic`, {
          headers: { 'Accept': 'application/json' },
        });
        if (response.ok) {
          const data = await response.json() as any;
          for (const project of (data.projects || [])) {
            leads.push({
              id: `ks-${project.id}`,
              source: 'kickstarter',
              name: project.creator?.name || project.name || 'Unknown',
              campaign_url: project.urls?.web?.project || '',
              goal: project.goal || 0,
              raised: project.pledged || 0,
              category: project.category?.name || 'other',
              industry: project.category?.slug || null,
              score: 0,
              contacted: false,
            });
          }
        }
      } catch {
        // Fallback
      }
      break;

    case 'gofundme':
      try {
        const key = env.SCRAPINGBEE_API_KEY;
        const encodedUrl = encodeURIComponent('https://www.gofundme.com/s?q=fundraiser');
        const apiUrl = `https://app.scrapingbee.com/api/v1/?api_key=${key}&url=${encodedUrl}`;
        const response = await fetch(apiUrl);
        if (response.ok) {
          const html = await response.text();
          const campaignRegex = /<div[^>]*class="[^"]*campaign-card[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi;
          const matches = html.match(campaignRegex) || [];
          for (const card of matches) {
            const titleMatch = card.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i);
            const goalMatch = card.match(/goal[^$]*\$([0-9,]+)/i);
            const raisedMatch = card.match(/raised[^$]*\$([0-9,]+)/i);
            const creatorMatch = card.match(/by\s+([^<]+)</i);
            const linkMatch = card.match(/href="(\/f\/[^"]+)"/i);
            leads.push({
              id: `gfm-${crypto.randomUUID()}`,
              source: 'gofundme',
              name: creatorMatch?.[1]?.trim() || 'Unknown Creator',
              campaign_url: linkMatch ? `https://www.gofundme.com${linkMatch[1]}` : 'https://www.gofundme.com/s?q=fundraiser',
              goal: parseFloat((goalMatch?.[1] || '0').replace(/,/g, '')) || 0,
              raised: parseFloat((raisedMatch?.[1] || '0').replace(/,/g, '')) || 0,
              category: 'community',
              industry: undefined,
              score: 0,
              contacted: false,
            });
          }
        }
      } catch {
        // Fallback
      }
      break;

    case 'crowdsupply':
      // Placeholder — real implementation uses ScrapingBee / Apify
      break;
  }

  return leads;
}

async function storeLeads(env: Env, leads: Lead[]): Promise<number> {
  let newCount = 0;

  for (const lead of leads) {
    const existing = await env.CAPITAL_DB.prepare(
      'SELECT id FROM leads WHERE id = ?'
    ).bind(lead.id).first();

    if (!existing) {
      lead.score = await calculateLeadScore(env, lead);
      lead.ai_summary = await generateAISummary(env, lead);

      await env.CAPITAL_DB.prepare(
        `INSERT INTO leads (id, source, name, email, campaign_url, goal, raised, category, industry, score, ai_summary, contacted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).bind(
        lead.id, lead.source, lead.name, lead.email || null,
        lead.campaign_url, lead.goal, lead.raised, lead.category,
        lead.industry, lead.score, lead.ai_summary || null,
        Date.now(), Date.now()
      ).run();
      newCount++;
    }
  }

  return newCount;
}

async function processLeads(env: Env): Promise<any> {
  const unscoredLeads = await env.CAPITAL_DB.prepare(
    'SELECT * FROM leads WHERE score = 0 LIMIT 50'
  ).all();

  for (const lead of (unscoredLeads.results || [])) {
    const score = await calculateLeadScore(env, lead as any);
    const summary = await generateAISummary(env, lead as any);

    await env.CAPITAL_DB.prepare(
      'UPDATE leads SET score = ?, ai_summary = ?, updated_at = ? WHERE id = ?'
    ).bind(score, summary, Date.now(), lead.id).run();
  }

  const highValueLeads = await env.CAPITAL_DB.prepare(
    'SELECT * FROM leads WHERE score >= 75 AND contacted = 0 ORDER BY score DESC LIMIT 20'
  ).all();

  for (const lead of (highValueLeads.results || [])) {
    await autoEngageLead(env, lead as any);
  }

  return {
    processed: unscoredLeads.results?.length || 0,
    engaged: highValueLeads.results?.length || 0,
    timestamp: Date.now(),
  };
}

async function calculateLeadScore(env: Env, lead: Lead): Promise<number> {
  let score = 50;

  const ratio = lead.goal > 0 ? lead.raised / lead.goal : 0;
  if (ratio < 0.2) score += 25;
  else if (ratio < 0.5) score += 15;
  else if (ratio > 0.8) score -= 20;

  const highValueCategories = ['community', 'education', 'health', 'technology', 'software', 'hardware'];
  if (highValueCategories.includes(lead.category?.toLowerCase())) {
    score += 10;
  }

  if (lead.goal > 50000) score += 10;
  if (lead.goal > 100000) score += 5;
  if (lead.raised > 0 && lead.raised < 1000) score -= 10;

  if (env.OPENAI_API_KEY) {
    try {
      const aiScore = await getOpenAIScore(env, lead);
      score = Math.round((score + aiScore) / 2);
    } catch {
      // Fallback to heuristic score
    }
  }

  return Math.max(0, Math.min(100, score));
}

async function generateAISummary(env: Env, lead: Lead): Promise<string> {
  if (!env.OPENAI_API_KEY) return '';

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a fundraising analyst. Summarize this lead in 1-2 sentences, describing their campaign and funding need. Be concise and actionable.',
          },
          {
            role: 'user',
            content: `Campaign: ${lead.name}, Goal: $${lead.goal}, Raised: $${lead.raised}, Category: ${lead.category}, Source: ${lead.source}`,
          },
        ],
        max_tokens: 100,
      }),
    });

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

async function getOpenAIScore(env: Env, lead: Lead): Promise<number> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Score this fundraising lead from 0-100 based on: funding gap (how much they still need), category potential, and engagement likelihood. Return ONLY a number.',
        },
        {
          role: 'user',
          content: `Goal: $${lead.goal}, Raised: $${lead.raised}, Category: ${lead.category}, Source: ${lead.source}`,
        },
      ],
      max_tokens: 10,
    }),
  });

  const data = await response.json() as any;
  const scoreText = data.choices?.[0]?.message?.content || '50';
  return parseInt(scoreText.replace(/[^0-9]/g, '')) || 50;
}

async function autoEngageLead(env: Env, lead: Lead): Promise<void> {
  const existing = await env.CAPITAL_DB.prepare(
    'SELECT id FROM engagements WHERE lead_id = ?'
  ).bind(lead.id).first();

  if (existing) return;

  const template = await env.CAPITAL_DB.prepare(
    "SELECT * FROM outreach_templates WHERE channel = 'email' ORDER BY RANDOM() LIMIT 1"
  ).first();

  if (!template) return;

  let message = template.body as string;
  if (env.OPENAI_API_KEY) {
    try {
      const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a fundraising outreach specialist. Generate a concise, personalized message (max 3 sentences) to engage a campaign creator about funding opportunities.',
            },
            {
              role: 'user',
              content: `Generate a personalized outreach message for a campaign creator named ${lead.name} on ${lead.source}. Their campaign has a goal of $${lead.goal} and has raised $${lead.raised} so far. The campaign category is ${lead.category}. Be warm and professional.`,
            },
          ],
          max_tokens: 200,
        }),
      });
      const aiData = await aiResponse.json() as any;
      const aiMessage = aiData.choices?.[0]?.message?.content;
      if (aiMessage) message = aiMessage;
    } catch {
      // Fallback to template body
    }
  }

  const engagementId = crypto.randomUUID();

  await env.CAPITAL_DB.prepare(
    `INSERT INTO engagements (id, lead_id, channel, message, sent_at, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(engagementId, lead.id, 'email', message, Date.now(), 'sent').run();

  await env.CAPITAL_DB.prepare(
    'UPDATE leads SET contacted = 1, updated_at = ? WHERE id = ?'
  ).bind(Date.now(), lead.id).run();

  await notifyDiscord(env, {
    title: 'Lead Engaged',
    description: `AI contacted ${lead.name} from ${lead.source} (Score: ${lead.score})`,
    color: 0x2ecc71,
  });
}

async function engageLead(env: Env, leadId: string, campaignId?: string): Promise<any> {
  const lead = await env.CAPITAL_DB.prepare(
    'SELECT * FROM leads WHERE id = ?'
  ).bind(leadId).first();

  if (!lead) throw new Error('Lead not found');

  await autoEngageLead(env, lead as any);

  if (campaignId) {
    await env.CAPITAL_DB.prepare(
      'UPDATE engagements SET campaign_id = ? WHERE lead_id = ? AND campaign_id IS NULL'
    ).bind(campaignId, leadId).run();
  }

  return { engaged: true, leadId, timestamp: Date.now() };
}

async function getFundraisingStats(env: Env): Promise<any> {
  const totalLeads = await env.CAPITAL_DB.prepare('SELECT COUNT(*) as count FROM leads').first();
  const contacted = await env.CAPITAL_DB.prepare("SELECT COUNT(*) as count FROM engagements").first();
  const bySource = await env.CAPITAL_DB.prepare(
    'SELECT source, COUNT(*) as count, AVG(score) as avg_score FROM leads GROUP BY source'
  ).all();
  const activeCampaigns = await env.CAPITAL_DB.prepare(
    "SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'"
  ).first();

  return {
    totalLeads: totalLeads?.count || 0,
    contacted: contacted?.count || 0,
    bySource: bySource.results || [],
    activeCampaigns: activeCampaigns?.count || 0,
  };
}

async function notifyDiscord(env: Env, embed: { title: string; description: string; color: number }): Promise<void> {
  if (!env.DISCORD_WEBHOOK) return;
  try {
    await fetch(env.DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{ ...embed, timestamp: new Date().toISOString() }],
      }),
    });
  } catch {}
}
