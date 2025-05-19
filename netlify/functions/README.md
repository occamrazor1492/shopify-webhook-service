# Shopify Webhook Functions

This directory contains Netlify serverless functions for processing Shopify webhooks.

## Files

- `customer-tag-webhook.js` - Processes `customers/create` webhooks and applies tags based on the registration source

## Testing Locally

1. Create a `.env` file in the project root with the required environment variables (see `.env.example`)
2. Start the Netlify dev server:
   ```
   npm run dev
   ```
3. Test the webhook using the provided test script:
   ```
   node test-webhook.js store1
   ```

## Debugging

When testing locally, you can see detailed logs in the Netlify CLI output. When deployed, check the Netlify Functions logs in the Netlify dashboard.

## Webhook URL

When deployed, your webhook URL will be:
```
https://your-netlify-site.netlify.app/.netlify/functions/customer-tag-webhook
```

Use this URL when configuring webhooks in the Shopify admin panel.

## Common Issues

- **401 Unauthorized**: Check that your webhook secret is correct
- **500 Internal Server Error**: Check the function logs for details
- **No Tags Applied**: Verify the environment variable configuration for tags

## Extending

To handle additional webhook types, create new function files in this directory.