# Extract Form Fields Edge Function

Extracts native PDF form fields (AcroForms) from uploaded PDFs.

## Deploy

```bash
# Install Supabase CLI if needed
brew install supabase/tap/supabase

# Login
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Deploy
supabase functions deploy extract-form-fields
```

Or paste `index.ts` code into Supabase Dashboard → Edge Functions → New Function.

## Usage

```javascript
const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-form-fields`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ANON_KEY}`,
  },
  body: JSON.stringify({ pdfBase64: "..." }),
});

const { success, fields, count } = await response.json();
```

## Response

```json
{
  "success": true,
  "fields": [
    {
      "name": "firstName",
      "type": "PDFTextField",
      "value": "",
      "options": [],
      "rect": { "x": 100, "y": 650, "width": 200, "height": 20 },
      "pageCount": 1
    }
  ],
  "count": 5
}
```
