/**
 * Tests for Chat API
 */

import { createMocks } from 'node-mocks-http';
import chatHandler from '../../pages/api/chat';

// Mock dependencies
jest.mock('../../lib/supabaseClient');
jest.mock('../../lib/anthropic');

describe('/api/chat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reject non-POST requests', async () => {
    const { req, res } = createMocks({
      method: 'GET',
    });

    await chatHandler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toEqual({
      error: 'Method not allowed',
    });
  });

  it('should return 400 when required fields are missing', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      headers: {
        authorization: 'Bearer test-jwt',
      },
      body: {
        message: 'Hello',
        // Missing documentId
      },
    });

    await chatHandler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.error).toContain('Invalid request body');
  });

  it('should process chat message successfully', async () => {
    // Flexible chainable query builder: terminal calls resolve with table-
    // appropriate data so both the auth lookup and buildDocumentChatContext run.
    const { getServiceSupabase } = require('../../lib/supabaseClient');
    const makeQuery = (table) => {
      const result = table === 'fields'
        ? { data: [{ field_name: 'Full Name', field_type: 'text', field_value: null, explanation: 'Your name' }], error: null }
        : { data: { id: 'doc-123', user_id: 'user-123', created_by: 'user-123', org_id: null, file_name: 'form.pdf', document_type: 'unknown' }, error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => Promise.resolve(result),
        single: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
        insert: () => Promise.resolve({ data: {}, error: null }),
      };
      return builder;
    };
    const mockSupabase = {
      auth: {
        getUser: jest.fn(() => Promise.resolve({
          data: { user: { id: 'user-123' } },
          error: null,
        })),
      },
      from: jest.fn((table) => makeQuery(table)),
    };
    getServiceSupabase.mockReturnValue(mockSupabase);

    // Mock the Anthropic chat completion
    const { chatWithCo } = require('../../lib/anthropic');
    chatWithCo.mockResolvedValue({
      message: 'Xin chào! Tôi có thể giúp gì cho bạn?',
      usage: { total_tokens: 100 },
    });

    const { req, res } = createMocks({
      method: 'POST',
      headers: {
        authorization: 'Bearer test-jwt',
      },
      body: {
        message: 'What is this field?',
        documentId: 'doc-123',
      },
    });

    await chatHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.response).toBeDefined();
    expect(data.response).toContain('Xin chào');
  });

  it('authorizes org members on shared enterprise documents', async () => {
    const { getServiceSupabase } = require('../../lib/supabaseClient');
    // Document owned by another user but in an org the caller belongs to.
    const makeQuery = (table) => {
      const result = table === 'org_memberships'
        ? { data: { org_id: 'org-1' }, error: null }
        : table === 'fields'
          ? { data: [], error: null }
          : { data: { id: 'doc-9', user_id: 'someone-else', created_by: 'someone-else', org_id: 'org-1', file_name: 'shared.pdf', document_type: 'unknown' }, error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => Promise.resolve(result),
        single: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
      };
      return builder;
    };
    getServiceSupabase.mockReturnValue({
      auth: {
        getUser: jest.fn(() => Promise.resolve({
          data: { user: { id: 'user-123' } },
          error: null,
        })),
      },
      from: jest.fn((table) => makeQuery(table)),
    });

    const { chatWithCo } = require('../../lib/anthropic');
    chatWithCo.mockResolvedValue({ message: 'Org doc answer', usage: {} });

    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer test-jwt' },
      body: { message: 'Explain this document', documentId: 'doc-9' },
    });

    await chatHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).response).toBe('Org doc answer');
  });

  it('should return 404 when document not found', async () => {
    const { getServiceSupabase } = require('../../lib/supabaseClient');
    const mockSupabase = {
      auth: {
        getUser: jest.fn(() => Promise.resolve({
          data: { user: { id: 'user-123' } },
          error: null,
        })),
      },
      from: jest.fn(() => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: () => Promise.resolve({ data: null, error: { message: 'Not found' } }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
        return builder;
      }),
    };
    getServiceSupabase.mockReturnValue(mockSupabase);

    const { req, res } = createMocks({
      method: 'POST',
      headers: {
        authorization: 'Bearer test-jwt',
      },
      body: {
        message: 'Hello',
        documentId: 'invalid-doc',
      },
    });

    await chatHandler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({
      error: 'Document not found',
    });
  });
});
