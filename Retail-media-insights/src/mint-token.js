'use strict';
// Dev helper: RMI_AUTH_SECRET=... node src/mint-token.js <admin|advertiser> <principalId> [ttlSeconds]
const { mintToken } = require('./auth');

const [type, id, ttl] = process.argv.slice(2);
try {
  console.log(mintToken({ secret: process.env.RMI_AUTH_SECRET, principalType: type, principalId: id, ttlSeconds: ttl ? Number(ttl) : 3600 }));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
