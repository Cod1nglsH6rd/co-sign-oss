/**
 * PDF to Image API (quarantined)
 *
 * This endpoint is intentionally disabled until a fully supported
 * server-side renderer is reintroduced.
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(410).json({
    error: 'pdf_to_image_unavailable',
    message: 'This endpoint is disabled pending a supported server-side implementation.',
  });
}
