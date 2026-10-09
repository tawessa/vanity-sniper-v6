// published by v6 & tawessa but bune amk
import http2 from 'http2';
import { readFileSync, watch } from 'fs';
import WebSocket from 'ws';
import dns from 'dns';
import os from 'os';

dns.setDefaultResultOrder('ipv4first');
try {
  if (os.platform() !== 'win32' && process.setPriority) {
    process.setPriority(process.pid, os.constants.priority.PRIORITY_HIGH);
  }
} catch { }

const TARGET_GUILD_ID = "g id";
const TOKEN = "token gir";

const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

let mfaToken = "";
const guilds = new Map();
const cache = new Map();
let ws = null;
let http2Client = null;
let rateLimitReset = 0;
const startTime = Date.now();

const SP = Buffer.from('eyJicm93c2VyIjoiQ2hyb21lIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEzMi4wLjAuMCBTYWZhcmkvNTM3LjM2Iiwib3NfdmVyc2lvbiI6IjEwIn0=');

const initHttp2Client = async () => {
  if (http2Client) {
    try { http2Client.close(); } catch { }
  }

  const { connect } = await import('net');
  const { connect: tlsConnect } = await import('tls');

  http2Client = http2.connect('https://canary.discord.com', {
    settings: {
      enablePush: false,
      initialWindowSize: 2147483647,
      maxConcurrentStreams: 4294967295
    },
    peerMaxConcurrentStreams: 4294967295,
    maxSessionMemory: 8388608,
    createConnection: () => {
      const socket = connect({
        host: '162.159.135.232',
        port: 443,
        noDelay: true,
        keepAlive: true
      });
      socket.setNoDelay(true);
      return tlsConnect({
        socket,
        servername: 'canary.discord.com',
        ALPNProtocols: ['h2'],
        rejectUnauthorized: false
      });
    }
  });

  http2Client.on('error', () => { });
  http2Client.on('close', () => { });
  http2Client.setMaxListeners(0);
};

const prepareVanityRequest = (code) => {
  const payload = `{"code":"${code}"}`;
  const headers = {
    ':method': 'PATCH',
    ':scheme': 'https',
    ':authority': 'canary.discord.com',
    ':path': `/api/v10/guilds/${TARGET_GUILD_ID}/vanity-url`,
    'authorization': TOKEN,
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'x-super-properties': SP.toString(),
    'content-length': Buffer.byteLength(payload)
  };

  cache.set(code, {
    headers,
    body: Buffer.from(payload)
  });
};

const sendPatchRequest = (code) => {
  if (!code || !code.length || Date.now() < rateLimitReset) return;
  if (!http2Client || http2Client.destroyed) return;

  if (!cache.has(code)) {
    prepareVanityRequest(code);
  }

  const { headers, body } = cache.get(code);

  if (mfaToken && mfaToken.length > 0) {
    headers['x-discord-mfa-authorization'] = mfaToken;
  }

  for (let i = 0; i < 3; i++) {
    if (!http2Client || http2Client.destroyed) break;

    try {
      const stream = http2Client.request(headers, {
        endStream: false,
        weight: 512
      });

      let responseData = '';

      stream.on('data', (chunk) => {
        responseData += chunk.toString();
      });

      stream.on('end', () => {
        if (responseData) {
          try {
            const parsed = JSON.parse(responseData);
            processResponse(code, parsed);
          } catch { }
        }
      });

      stream.on('error', (err) => {
        processResponse(code, { error: err.message || 'Stream error' });
      });

      stream.end(body);
    } catch (err) {
      processResponse(code, { error: err.message || 'Request error' });
    }
  }
};

const processResponse = (code, parsed) => {
  if (parsed.retry_after) {
    rateLimitReset = Date.now() + (parsed.retry_after * 1000);
    console.log(`${GREEN}[ ! ] --> 'Rate limited: ${parsed.retry_after}s'${RESET}`);
    return;
  }

  if (parsed.code && !parsed.message) {
    console.log(`${GREEN}[ + ] --> ${JSON.stringify(parsed)}${RESET}`);
  } else if (parsed.message && (parsed.code === 50020 || parsed.code === 50024 || parsed.message.toLowerCase().includes('invalid') || parsed.message.toLowerCase().includes('taken') || parsed.message.toLowerCase().includes('geçersiz') || parsed.message.toLowerCase().includes('kullanılmış') || parsed.message.toLowerCase().includes('already') || parsed.message.toLowerCase().includes('unavailable'))) {
    console.log(`${GREEN}[ - ] --> ${JSON.stringify(parsed)}${RESET}`);
  } else if (parsed.message || parsed.error) {
    const errorMsg = parsed.message || parsed.error || 'Unknown error';
    console.log(`${GREEN}[ ! ] --> '${errorMsg}'${RESET}`);
  }
};

const connectWebSocket = () => {
  ws = new WebSocket('wss://gateway.discord.gg/?v=9', {
    perMessageDeflate: false,
    handshakeTimeout: 5000
  });

  let heartbeatTimer = null;

  ws.on('open', () => {
    console.log(`${GREEN}websocket baglandı${RESET}`);
  });

  ws.on('close', () => {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    setTimeout(connectWebSocket, 100);
  });

  ws.on('error', () => { });

  ws.on('message', (message) => {
    try {
      const { d, op, t } = JSON.parse(message);

      if (op === 10) {
        if (heartbeatTimer) clearTimeout(heartbeatTimer);

        ws.send(JSON.stringify({
          op: 2,
          d: {
            token: TOKEN,
            intents: 1,
            properties: { os: "linux", browser: "chrome", device: "my name is cihad" }
          }
        }));

        const getDynamicInterval = () => {
          const uptime = Date.now() - startTime;
          const baseInterval = d.heartbeat_interval * 0.1;
          if (uptime < 30000) {
            return Math.max(baseInterval * 0.1, 1000);
          }
          return Math.max(baseInterval * 0.08, 800);
        };

        const sendHeartbeat = () => {
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ op: 1, d: null }));
          }
        };

        sendHeartbeat();
        const interval = getDynamicInterval();
        heartbeatTimer = setInterval(sendHeartbeat, interval);
        return;
      }

      if (op === 7) {
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        setTimeout(connectWebSocket, 200);
        return;
      }

      if (t === 'READY' && d?.guilds) {
        console.log(`${GREEN}sex${RESET}`);
        const vanityGuilds = [];
        for (const guild of d.guilds) {
          if (guild.vanity_url_code) {
            guilds.set(guild.id, guild.vanity_url_code);
            prepareVanityRequest(guild.vanity_url_code);
            vanityGuilds.push({ id: guild.id, code: guild.vanity_url_code });
          }
        }
        if (vanityGuilds.length > 0) {
          const guildsObj = {};
          for (const g of vanityGuilds) {
            guildsObj[g.id] = g.code;
          }
          console.log(`${GREEN}${JSON.stringify(guildsObj, null, 2)}${RESET}`);
        }
        return;
      }

      if (t === 'GUILD_UPDATE' && d) {
        const guildId = d.guild_id || d.id;
        const newVanity = d.vanity_url_code;
        const oldVanity = guilds.get(guildId);

        if (oldVanity && (!newVanity || oldVanity !== newVanity)) {
          const guildUpdate = {};
          guildUpdate[guildId] = { old: oldVanity, new: newVanity || 'NULL' };
          console.log(`${GREEN}${JSON.stringify(guildUpdate, null, 2)}${RESET}`);
          sendPatchRequest(oldVanity);
        }

        if (newVanity) {
          if (!oldVanity) {
            const newGuild = {};
            newGuild[guildId] = newVanity;
            console.log(`${GREEN}${JSON.stringify(newGuild, null, 2)}${RESET}`);
          }
          guilds.set(guildId, newVanity);
          prepareVanityRequest(newVanity);
        } else if (oldVanity) {
          guilds.delete(guildId);
        }
        return;
      }
    } catch { }
  });
};

const loadMfaToken = () => {
  try {
    const data = readFileSync("mfa.txt", "utf8");
    const newMfa = data.trim();
    if (mfaToken !== newMfa) {
      mfaToken = newMfa;
      cache.clear();
      for (const [code] of guilds) {
        prepareVanityRequest(code);
      }
    }
  } catch { }
};

setInterval(loadMfaToken, 3000);
watch("mfa.txt", (eventType) => {
  if (eventType === "change") loadMfaToken();
});

setInterval(() => {
  if (cache.size > 3000) {
    const toRemove = Math.floor(cache.size * 0.15);
    const keys = Array.from(cache.keys());
    for (let i = 0; i < toRemove; i++) {
      cache.delete(keys[i]);
    }
  }
}, 300000);

setInterval(async () => {
  await initHttp2Client();
}, 4000);

process.on('uncaughtException', () => { });
process.on('unhandledRejection', () => { });

console.log(`${GREEN}hA Ha hA${RESET}`);
loadMfaToken();
await initHttp2Client();
console.log(`${GREEN}http2 işlemcisi başlatıldı${RESET}`);
setTimeout(() => {
  connectWebSocket();
}, 100);
