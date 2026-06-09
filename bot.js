const tmi = require('tmi.js');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const SUPABASE_URL = 'https://iqaqmecbihowhcrfyicn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxYXFtZWNiaWhvd2hjcmZ5aWNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMDEzMjcsImV4cCI6MjA5NjU3NzMyN30.IMFUVdiz--DfTZcsYxz0QErcEzrkLoX-rnMou5YjKe8';
const RESEND_API_KEY = 're_dhGu7qx7_GRD43878eiHq2dRbwsoCUL9e';
const ADMIN_EMAIL = 'eraumbigmac@gmail.com';
const CHANNEL = 'eraumbigmac_';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const POINTS_INTERVAL_MS = 5 * 60 * 1000;
const activeViewers = new Map();

// HTTP request using built-in https module
function httpPost(hostname, path, data, headers) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendEmail(r) {
  try {
    const result = await httpPost('api.resend.com', '/emails', {
      from: 'onboarding@resend.dev',
      to: ADMIN_EMAIL,
      subject: `🛒 ${r.user_name} resgatou: ${r.item_name}`,
      html: `<div style="font-family:sans-serif;padding:2rem;background:#111930;color:#e8eaf0;border-radius:12px">
        <h2 style="color:#fec017">🛒 Novo Resgate na Loja!</h2>
        <p><b style="color:#fec017">Utilizador:</b> ${r.user_name}</p>
        <p><b style="color:#fec017">Item:</b> ${r.item_name}</p>
        <p><b style="color:#fec017">Custo:</b> ${r.cost} MacPoints</p>
        <p><b style="color:#fec017">Data:</b> ${new Date(r.redeemed_at).toLocaleString('pt-PT')}</p>
        <a href="https://eraumbigmac.com" style="background:#fec017;color:#111930;padding:.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin-top:1rem">Ver Site</a>
      </div>`
    }, { 'Authorization': `Bearer ${RESEND_API_KEY}` });
    console.log('📧 Email enviado:', result.id || JSON.stringify(result));
  } catch(e) {
    console.error('❌ Erro email:', e.message);
  }
}

const client = new tmi.Client({ options: { debug: false }, channels: [CHANNEL] });
client.connect().catch(console.error);

client.on('connected', () => {
  console.log('✅ Bot conectado ao canal ' + CHANNEL);
  console.log('👂 A ouvir o chat e a gerir pontos...');
});

client.on('message', async (channel, tags, message, self) => {
  if (self) return;
  const login = tags['username'];
  const isSub = tags['subscriber'] === true || tags['subscriber'] === '1';
  const subTier = tags['badge-info']?.subscriber ? parseInt(tags['badge-info'].subscriber) : 0;
  activeViewers.set(login, { isSub, subTier, displayName: tags['display-name'] || login, lastSeen: Date.now() });

  const msg = message.trim().toLowerCase();
  const { data: giveaway } = await sb.from('giveaways').select('*').eq('status','active').single().catch(() => ({ data: null }));
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

async function giveWatchPoints() {
  const now = Date.now();
  for (const [login, data] of activeViewers) {
    if (now - data.lastSeen > 10 * 60 * 1000) { activeViewers.delete(login); continue; }
    try {
      const { data: user } = await sb.from('users').select('id,points').eq('twitch_login', login).single().catch(() => ({ data: null }));
      if (!user) continue;
      let pts = 0.25;
      if (data.isSub) pts = data.subTier >= 3000 ? 1 : data.subTier >= 2000 ? 0.75 : 0.5;
      await sb.from('users').update({ points: Math.round((user.points || 0) + pts), last_seen: new Date().toISOString() }).eq('id', user.id);
    } catch(e) {}
  }
  if (activeViewers.size > 0) console.log(`⭐ Pontos dados a ${activeViewers.size} viewers`);
}
setInterval(giveWatchPoints, POINTS_INTERVAL_MS);

sb.channel('store-redeems-notify')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'store_redeems' }, async (payload) => {
    console.log(`🛒 Resgate: ${payload.new.user_name} - ${payload.new.item_name}`);
    await sendEmail(payload.new);
  })
  .subscribe();

console.log('🛒 A ouvir resgates da loja...');

// Keep-alive HTTP server para o Railway
const http = require('http');
http.createServer((req, res) => res.end('Bot ERA UM BIG MAC online ✅')).listen(process.env.PORT || 3000);
console.log('🌐 Keep-alive server ativo');
