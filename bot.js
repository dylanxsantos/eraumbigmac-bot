const tmi = require('tmi.js');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://iqaqmecbihowhcrfyicn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxYXFtZWNiaWhvd2hjcmZ5aWNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMDEzMjcsImV4cCI6MjA5NjU3NzMyN30.IMFUVdiz--DfTZcsYxz0QErcEzrkLoX-rnMou5YjKe8';
const TWITCH_CLIENT_ID = '88u8nrcvfv04albkpbkcw5to3te46u';
const CHANNEL = 'eraumbigmac_';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Points per hour config
const POINTS_PER_HOUR = { viewer: 3, sub: 6, sub2: 9, sub3: 12 };
const POINTS_INTERVAL_MS = 5 * 60 * 1000; // Give points every 5 minutes
const POINTS_PER_INTERVAL = { viewer: 0.25, sub: 0.5, sub2: 0.75, sub3: 1 }; // 3pts/h = 0.25 per 5min

// Track who's active in chat (seen in last 5 minutes)
const activeViewers = new Map(); // login -> { isSub, subTier, lastSeen }

const client = new tmi.Client({
  options: { debug: false },
  channels: [CHANNEL]
});

client.connect().catch(console.error);
console.log('🤖 Bot a conectar ao canal ' + CHANNEL + '...');

client.on('connected', () => {
  console.log('✅ Bot conectado ao canal ' + CHANNEL);
  console.log('👂 A ouvir o chat e a gerir pontos...');
});

// Track chat activity
client.on('message', async (channel, tags, message, self) => {
  if (self) return;
  const login = tags['username'];
  const isSub = tags['subscriber'] === true || tags['subscriber'] === '1';
  const subTier = tags['badge-info']?.subscriber ? parseInt(tags['badge-info'].subscriber) : 0;

  // Update active viewers
  activeViewers.set(login, { isSub, subTier, displayName: tags['display-name'] || login, lastSeen: Date.now() });

  // Handle giveaway commands
  const msg = message.trim().toLowerCase();
  const { data: giveaway } = await sb.from('giveaways').select('*').eq('status', 'active').single().catch(() => ({ data: null }));

  if (giveaway && msg === giveaway.command.toLowerCase()) {
    if (giveaway.require_sub && !isSub) return;
    if (giveaway.min_points > 0) {
      const { data: user } = await sb.from('users').select('points').eq('twitch_login', login).single().catch(() => ({ data: null }));
      if (!user || user.points < giveaway.min_points) return;
    }
    const { error } = await sb.from('giveaway_entries').insert({
      giveaway_id: giveaway.id, twitch_login: login,
      display_name: tags['display-name'] || login, is_sub: isSub
    }).catch(e => ({ error: e }));
    if (!error) console.log(`✅ ${login} entrou no giveaway!`);
  }
});

// Give points every 5 minutes to active viewers
async function giveWatchPoints() {
  const now = Date.now();
  const fiveMin = 5 * 60 * 1000;

  // Remove inactive (not seen in 10 min)
  for (const [login, data] of activeViewers) {
    if (now - data.lastSeen > 10 * 60 * 1000) activeViewers.delete(login);
  }

  if (activeViewers.size === 0) return;
  console.log(`⭐ A dar pontos a ${activeViewers.size} viewers ativos...`);

  for (const [login, data] of activeViewers) {
    try {
      // Check if user exists in DB
      const { data: user } = await sb.from('users').select('id,points').eq('twitch_login', login).single().catch(() => ({ data: null }));
      if (!user) continue; // Only give points to registered users (logged in via site)

      let ptsToAdd = POINTS_PER_INTERVAL.viewer;
      if (data.isSub) {
        if (data.subTier >= 3000) ptsToAdd = POINTS_PER_INTERVAL.sub3;
        else if (data.subTier >= 2000) ptsToAdd = POINTS_PER_INTERVAL.sub2;
        else ptsToAdd = POINTS_PER_INTERVAL.sub;
      }

      const newPts = Math.round((user.points || 0) + ptsToAdd);
      await sb.from('users').update({ points: newPts, last_seen: new Date().toISOString() }).eq('id', user.id);
    } catch(e) {
      // Ignore errors per user
    }
  }
}

setInterval(giveWatchPoints, POINTS_INTERVAL_MS);
console.log('⏱️ Watch time points: activo (a cada 5 minutos)');
