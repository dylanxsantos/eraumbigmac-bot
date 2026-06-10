const tmi = require('tmi.js');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const http = require('http');

const SUPABASE_URL = 'https://iqaqmecbihowhcrfyicn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxYXFtZWNiaWhvd2hjcmZ5aWNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMDEzMjcsImV4cCI6MjA5NjU3NzMyN30.IMFUVdiz--DfTZcsYxz0QErcEzrkLoX-rnMou5YjKe8';
const RESEND_API_KEY = 're_dhGu7qx7_GRD43878eiHq2dRbwsoCUL9e';
const ADMIN_EMAIL = 'dylanxavierssantos@gmail.com';
const CHANNEL = 'eraumbigmac_';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Points per message
const CHAT_POINTS = { viewer: 10, sub1: 20, sub2: 30, sub3: 40 };

// Streak bonuses
const STREAK_BONUSES = { 3: 50, 7: 150, 14: 400, 30: 1000 };

const client = new tmi.Client({ options: { debug: false }, channels: [CHANNEL] });
client.connect().catch(console.error);

client.on('connected', () => {
  console.log('✅ Bot conectado ao canal ' + CHANNEL);
  console.log('👂 A ouvir o chat e a gerir pontos...');
});

client.on('message', async (channel, tags, message, self) => {
  if (self) return;
  const login = tags['username'];
  const displayName = tags['display-name'] || login;
  const isSub = tags['subscriber'] === true || tags['subscriber'] === '1';
  const subTier = tags['badge-info']?.subscriber ? parseInt(tags['badge-info'].subscriber) : 0;

  // Handle giveaway commands
  const msg = message.trim().toLowerCase();
  try {
    const { data: giveaway } = await sb.from('giveaways').select('*').eq('status','active').single();
    if (giveaway && msg === giveaway.command.toLowerCase()) {
      if (giveaway.require_sub && !isSub) return;
      if (giveaway.min_points > 0) {
        const { data: user } = await sb.from('users').select('points').eq('twitch_login', login).single();
        if (!user || user.points < giveaway.min_points) return;
      }
      const { error } = await sb.from('giveaway_entries').insert({
        giveaway_id: giveaway.id, twitch_login: login, display_name: displayName, is_sub: isSub
      });
      if (!error) console.log(`✅ ${login} entrou no giveaway!`);
      return;
    }
  } catch(e) {}

  // Give points per message
  try {
    const { data: user } = await sb.from('users').select('id,points,streak,last_stream_date').eq('twitch_login', login).single();
    if (!user) return;

    // Calculate points
    let pts = CHAT_POINTS.viewer;
    if (isSub) pts = subTier >= 3000 ? CHAT_POINTS.sub3 : subTier >= 2000 ? CHAT_POINTS.sub2 : CHAT_POINTS.sub1;

    // Streak logic
    const today = new Date().toDateString();
    const lastDate = user.last_stream_date ? new Date(user.last_stream_date).toDateString() : null;
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    let newStreak = user.streak || 0;
    let streakBonus = 0;

    if (lastDate !== today) {
      if (lastDate === yesterday) {
        newStreak += 1;
      } else if (lastDate === null || lastDate !== yesterday) {
        newStreak = 1;
      }

      // Check streak bonuses
      if (STREAK_BONUSES[newStreak]) {
        streakBonus = STREAK_BONUSES[newStreak];
        console.log(`🔥 ${displayName} atingiu streak de ${newStreak} dias! +${streakBonus} pts bónus`);
      }
    }

    const newPts = (user.points || 0) + pts + streakBonus;
    await sb.from('users').update({
      points: newPts,
      streak: newStreak,
      last_stream_date: new Date().toISOString(),
      last_seen: new Date().toISOString()
    }).eq('id', user.id);

  } catch(e) {}
});

// Listen for store redeems and send email
async function sendEmail(r) {
  try {
    const body = JSON.stringify({
      from: 'onboarding@resend.dev',
      to: ADMIN_EMAIL,
      subject: `🛒 ${r.user_name} resgatou: ${r.item_name}`,
      html: `<div style="font-family:sans-serif;padding:2rem;background:#111930;color:#e8eaf0;border-radius:12px">
        <h2 style="color:#fec017">🛒 Novo Resgate na Loja!</h2>
        <p><b style="color:#fec017">Utilizador:</b> ${r.user_name}</p>
        <p><b style="color:#fec017">Item:</b> ${r.item_name}</p>
        <p><b style="color:#fec017">Custo:</b> ${r.cost} Pontos</p>
        <p><b style="color:#fec017">Data:</b> ${new Date(r.redeemed_at).toLocaleString('pt-PT')}</p>
        <a href="https://eraumbigmac.com" style="background:#fec017;color:#111930;padding:.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin-top:1rem">Ver Site</a>
      </div>`
    });
    const req = https.request({ hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>console.log('📧 Email:', d)); });
    req.on('error', e => console.error('❌ Email error:', e.message));
    req.write(body); req.end();
  } catch(e) { console.error('❌ Email error:', e.message); }
}

sb.channel('store-redeems-notify')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'store_redeems' }, async (payload) => {
    console.log(`🛒 Resgate: ${payload.new.user_name} - ${payload.new.item_name}`);
    await sendEmail(payload.new);
  })
  .subscribe();

console.log('🛒 A ouvir resgates da loja...');

// Keep-alive
http.createServer((req, res) => res.end('Bot ERA UM BIG MAC online ✅')).listen(process.env.PORT || 8080);
console.log('🌐 Keep-alive server ativo');
