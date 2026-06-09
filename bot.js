const tmi = require('tmi.js');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://iqaqmecbihowhcrfyicn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxYXFtZWNiaWhvd2hjcmZ5aWNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMDEzMjcsImV4cCI6MjA5NjU3NzMyN30.IMFUVdiz--DfTZcsYxz0QErcEzrkLoX-rnMou5YjKe8';
const CHANNEL = 'eraumbigmac_';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const client = new tmi.Client({
  options: { debug: false },
  channels: [CHANNEL]
});

client.connect();
console.log('🤖 Bot conectado ao canal ' + CHANNEL);

client.on('message', async (channel, tags, message, self) => {
  if (self) return;
  const msg = message.trim().toLowerCase();

  // Buscar giveaway ativo
  const { data: giveaway } = await sb
    .from('giveaways')
    .select('*')
    .eq('status', 'active')
    .single();

  if (!giveaway) return;

  // Verificar se o comando corresponde
  if (msg !== giveaway.command.toLowerCase()) return;

  const login = tags['username'];
  const displayName = tags['display-name'] || login;
  const isSub = tags['subscriber'] === true || tags['subscriber'] === '1';

  // Verificar requisitos
  if (giveaway.require_sub && !isSub) {
    console.log(`❌ ${login} tentou participar mas não é sub`);
    return;
  }

  // Verificar pontos mínimos
  if (giveaway.min_points > 0) {
    const { data: user } = await sb.from('users').select('points').eq('twitch_login', login).single();
    if (!user || user.points < giveaway.min_points) {
      console.log(`❌ ${login} não tem pontos suficientes`);
      return;
    }
  }

  // Registar participante
  const { error } = await sb.from('giveaway_entries').insert({
    giveaway_id: giveaway.id,
    twitch_login: login,
    display_name: displayName,
    is_sub: isSub
  });

  if (!error) {
    console.log(`✅ ${displayName} entrou no giveaway!`);
  }
});

console.log('👂 A ouvir o chat...');
