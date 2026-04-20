'use strict';

const crypto = require('crypto');

function timingSafeEqualString(a, b) {
  const ab = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function getBearerToken(req) {
  const raw = req.headers.authorization || req.headers.Authorization;
  if (!raw || typeof raw !== 'string') return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function parseScopes(raw) {
  return String(raw || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function createPersistenceAuth(options = {}) {
  const enabled = options.enabled != null
    ? !!options.enabled
    : process.env.MOCK_RECEIPT_PERSISTENCE_AUTH_ENABLED === '1';

  const requiredToken =
    options.token ||
    process.env.MOCK_RECEIPT_PERSISTENCE_TOKEN ||
    '';

  const scopeMap = {
    canonicalRead: parseScopes(process.env.MOCK_RECEIPT_PERSISTENCE_SCOPE_CANONICAL_READ || 'canonical:read,canonical:write'),
    canonicalWrite: parseScopes(process.env.MOCK_RECEIPT_PERSISTENCE_SCOPE_CANONICAL_WRITE || 'canonical:write'),
    challengeRead: parseScopes(process.env.MOCK_RECEIPT_PERSISTENCE_SCOPE_CHALLENGE_READ || 'challenge:read,challenge:write'),
    challengeWrite: parseScopes(process.env.MOCK_RECEIPT_PERSISTENCE_SCOPE_CHALLENGE_WRITE || 'challenge:write'),
    admin: parseScopes(process.env.MOCK_RECEIPT_PERSISTENCE_SCOPE_ADMIN || 'admin'),
  };

  function getGrantedScopes(req) {
    const raw = req.headers['x-mock-receipt-scopes'] || '';
    return parseScopes(raw);
  }

  function requireAuth(req, res, neededScopes = []) {
    if (!enabled) return true;

    const token = getBearerToken(req);
    if (!token || !requiredToken || !timingSafeEqualString(token, requiredToken)) {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: false,
        code: 'unauthorized',
      }));
      return false;
    }

    if (!neededScopes.length) return true;

    const granted = new Set(getGrantedScopes(req));
    const allowed = neededScopes.every((scope) => granted.has(scope));
    if (!allowed) {
      res.statusCode = 403;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: false,
        code: 'forbidden',
        neededScopes,
      }));
      return false;
    }

    return true;
  }

  return {
    enabled,
    scopeMap,
    requireAuth,
  };
}

module.exports = {
  createPersistenceAuth,
};
