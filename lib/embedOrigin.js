const EMBED_ORIGIN_STRICT_FLAG = 'COSIGN_EMBED_ORIGIN_STRICT';

function canonicalizeOrigin(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null') return null;

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

function extractRequestOrigin(req) {
  const parentOriginHeader = req?.headers?.['x-cosign-parent-origin'];
  const originHeader = req?.headers?.origin;
  const refererHeader = req?.headers?.referer;
  const parentOrigin = canonicalizeOrigin(Array.isArray(parentOriginHeader) ? parentOriginHeader[0] : parentOriginHeader);
  if (parentOrigin) return parentOrigin;
  const origin = canonicalizeOrigin(Array.isArray(originHeader) ? originHeader[0] : originHeader);
  if (origin) return origin;
  return canonicalizeOrigin(Array.isArray(refererHeader) ? refererHeader[0] : refererHeader);
}

function isEmbedOriginStrictEnabled() {
  return String(process.env[EMBED_ORIGIN_STRICT_FLAG] || '').toLowerCase() === 'true';
}

function normalizeEmbedOriginInput(embedOrigin) {
  const canonical = canonicalizeOrigin(embedOrigin);
  if (!canonical) return null;
  return canonical;
}

function enforceEmbedOriginForSession({ req, session, endpoint = 'session-endpoint' }) {
  const expectedOrigin = canonicalizeOrigin(session?.embed_origin);
  const isEmbedSession = session?.send_method === 'embed' || Boolean(expectedOrigin);

  if (!isEmbedSession || !expectedOrigin) {
    return {
      ok: true,
      expectedOrigin,
      requestOrigin: extractRequestOrigin(req),
      strict: isEmbedOriginStrictEnabled(),
    };
  }

  const requestOrigin = extractRequestOrigin(req);
  const strict = isEmbedOriginStrictEnabled();

  if (!requestOrigin) {
    console.warn('[EmbedOrigin] Missing request origin for embed session', {
      endpoint,
      strict,
      sessionId: session?.id,
      expectedOrigin,
    });

    if (strict) {
      return {
        ok: false,
        status: 403,
        errorCode: 'embed_origin_required',
        message: 'Embed origin is required for this session',
      };
    }

    return { ok: true, expectedOrigin, requestOrigin: null, strict };
  }

  if (requestOrigin !== expectedOrigin) {
    console.warn('[EmbedOrigin] Origin mismatch', {
      endpoint,
      strict,
      sessionId: session?.id,
      expectedOrigin,
      requestOrigin,
    });

    if (strict) {
      return {
        ok: false,
        status: 403,
        errorCode: 'embed_origin_mismatch',
        message: 'This embed origin is not allowed for the session',
      };
    }
  }

  return { ok: true, expectedOrigin, requestOrigin, strict };
}

export {
  canonicalizeOrigin,
  extractRequestOrigin,
  isEmbedOriginStrictEnabled,
  normalizeEmbedOriginInput,
  enforceEmbedOriginForSession,
};
