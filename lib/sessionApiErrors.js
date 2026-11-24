const TOKEN_STATUS_MAP = {
  invalid_token: 400,
  not_found: 404,
  expired: 403,
  revoked: 403,
  already_completed: 403,
};

const TOKEN_MESSAGE_MAP = {
  invalid_token: 'Invalid session token',
  not_found: 'Session not found',
  expired: 'Session has expired',
  revoked: 'Session has been revoked',
  already_completed: 'Session is already completed',
};

function buildSessionError(errorCode, message, extra = {}) {
  return {
    error: errorCode,
    errorCode,
    message,
    ...extra,
  };
}

function sendSessionError(res, status, errorCode, message, extra = {}) {
  return res.status(status).json(buildSessionError(errorCode, message, extra));
}

function sendMethodNotAllowed(res, message = 'Method not allowed') {
  return sendSessionError(res, 405, 'method_not_allowed', message);
}

function sendInvalidRequest(res, message = 'Invalid request body', extra = {}) {
  return sendSessionError(res, 400, 'invalid_request_body', message, extra);
}

function sendTokenError(res, tokenError) {
  const status = TOKEN_STATUS_MAP[tokenError] || 400;
  const errorCode = tokenError === 'not_found' ? 'session_not_found' : tokenError;
  const message = TOKEN_MESSAGE_MAP[tokenError] || 'Session token validation failed';
  return sendSessionError(res, status, errorCode, message);
}

export {
  buildSessionError,
  sendSessionError,
  sendMethodNotAllowed,
  sendInvalidRequest,
  sendTokenError,
};
