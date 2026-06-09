const tmi = require('tmi.js');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://iqaqmecbihowhcrfyicn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxYXFtZWNiaWhvd2hjcmZ5aWNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMDEzMjcsImV4cCI6MjA5NjU3NzMyN30.IMFUVdiz--DfTZcsYxz0QErcEzrkLoX-rnMou5YjKe8';
const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_dhGu7qx7_GRD43878eiHq2dRbwsoCUL9e';
const ADMIN_EMAIL = 'eraumbigmac@gmail.com';
const CHANNEL = 'eraumbigmac_';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Points per 5 minutes
const POINTS_PER_INTERVAL = { viewer: 0.25, sub: 0.5, sub2: 0.75, sub3: 1 };
const POINTS_INTERVAL_MS = 5 * 60 * 1000;
const activeViewers = new Map();

const client = new tmi.Client({ options: { debug: false }, channels: [CHANNEL] });
client.connect().catch(console.error);

client.on('connected', () => {
  console.log('✅ Bot conectado ao canal ' + CHANNEL);
  console.log('👂 A ouvir o chat...');
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

// Watch time points every 5 minutes
async function giveWatchPoints() {
  const now = Date.now();
  for (const [login, data] of activeViewers) {
    if (now - data.lastSeen > 10 * 60 * 1000) { activeViewers.delete(login); continue; }
  }
  if (activeViewers.size === 0) return;
  console.log(`⭐ A dar pontos a ${activeViewers.size} viewers ativos...`);
  for (const [login, data] of activeViewers) {
    try {
      const { data: user } = await sb.from('users').select('id,points').eq('twitch_login', login).single().catch(() => ({ data: null }));
      if (!user) continue;
      let pts = POINTS_PER_INTERVAL.viewer;
      if (data.isSub) {
        if (data.subTier >= 3000) pts = POINTS_PER_INTERVAL.sub3;
        else if (data.subTier >= 2000) pts = POINTS_PER_INTERVAL.sub2;
        else pts = POINTS_PER_INTERVAL.sub;
      }
      await sb.from('users').update({ points: Math.round((user.points || 0) + pts), last_seen: new Date().toISOString() }).eq('id', user.id);
    } catch(e) {}
  }
}
setInterval(giveWatchPoints, POINTS_INTERVAL_MS);

// Listen for store redeems and send email
async function listenStoreRedeems() {
  sb.channel('store-redeems-notify')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'store_redeems' }, async (payload) => {
      const r = payload.new;
      console.log(`🛒 Novo resgate: ${r.user_name} - ${r.item_name} (${r.cost} pts)`);
      await sendEmail(r);
    })
    .subscribe();
}

async function sendEmail(r) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'onboarding@resend.dev',
        to: ADMIN_EMAIL,
        subject: `🛒 ${r.user_name} resgatou: ${r.item_name}`,
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto;background:#111930;color:#e8eaf0;padding:2rem;border-radius:12px">
            <h2 style="color:#fec017">🛒 Novo Resgate na Loja!</h2>
            <div style="background:#1a2540;border-radius:8px;padding:1.25rem">
              <p><strong style="color:#fec017">Utilizador:</strong> ${r.user_name}</p>
              <p><strong style="color:#fec017">Item:</strong> ${r.item_name}</p>
              <p><strong style="color:#fec017">Custo:</strong> ${r.cost} MacPoints</p>
              <p><strong style="color:#fec017">Data:</strong> ${new Date(r.redeemed_at).toLocaleString('pt-PT')}</p>
            </div>
            <a href="https://eraumbigmac.com" style="display:inline-block;background:#fec017;color:#111930;padding:.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:700;margin-top:1rem">Ver Site</a>
          </div>
        `
      })
    });
    const data = await res.json();
    console.log('📧 Email enviado:', data.id || data.message || JSON.stringify(data));
  } catch(e) {
    console.error('❌ Erro ao enviar email:', e.message);
  }
}

listenStoreRedeems();
console.log('🛒 A ouvir resgates da loja...');
