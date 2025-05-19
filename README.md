# Shopify Webhook Service for Multi-Instance Customer Tagging

This service provides an independent Netlify serverless function that processes Shopify customer creation webhooks and adds appropriate tags based on which Hydrogen frontend the customer registered from.

## Features

- **Multi-instance support**: Automatically identifies which Hydrogen frontend a customer registered from
- **Configurable tagging**: Define different tag sets for different frontend instances
- **Standalone deployment**: Can be deployed independently from your main application
- **Secure**: Validates Shopify webhook signatures and uses environment variables for sensitive data

## How It Works

1. When a customer registers on any of your Hydrogen frontends, the frontend includes source information
2. Shopify creates the customer and sends a webhook to this service
3. The service identifies which frontend the customer came from
4. Based on configuration, it applies the appropriate tags to the customer
5. All actions are logged for monitoring and debugging

## Prerequisites

- Netlify account
- Shopify store with Admin API access
- Node.js and npm (for local development/testing)

## Deployment

### Option 1: Deploy via Netlify UI

1. Log in to your Netlify account
2. Create a new site from Git
3. Select this repository/directory 
4. Configure the build settings:
   - Build command: `echo 'No build required'`
   - Publish directory: `public`
5. Add environment variables (see [Configuration](#configuration))
6. Deploy the site

### Option 2: Deploy via Netlify CLI

1. Install Netlify CLI: `npm install -g netlify-cli`
2. Navigate to this directory
3. Run: `netlify deploy --prod`
4. Configure environment variables through the Netlify UI

## Configuration

Configure the following environment variables in Netlify:

| Variable | Description | Example |
|----------|-------------|---------|
| `SHOPIFY_STORE_DOMAIN` | Your Shopify store domain | `your-store.myshopify.com` |
| `SHOPIFY_ADMIN_API_ACCESS_TOKEN` | Admin API access token | `shpat_xxxxxxxxxxxx` |
| `SHOPIFY_WEBHOOK_SECRET` | Webhook secret for validation | `whsec_xxxxxxxxxxxx` |
| `SHOPIFY_API_VERSION` | Shopify API version | `2023-10` |
| `DEFAULT_CUSTOMER_TAGS` | Default tags for all customers | `new-customer,web-signup` |
| `CUSTOMER_TAGS_[INSTANCE]` | Tags for specific instance | `CUSTOMER_TAGS_STORE1=store1,north-america` |

## Setting Up Shopify Webhook

1. Go to Shopify admin > Settings > Notifications
2. Scroll to Webhooks section and click "Create webhook"
3. Select event: "Customer creation"
4. Enter your Netlify function URL: `https://your-netlify-site.netlify.app/.netlify/functions/customer-tag-webhook`
5. Select format: JSON
6. Click "Save webhook" and copy the generated secret
7. Add the secret to your Netlify environment variables as `SHOPIFY_WEBHOOK_SECRET`

## Frontend Integration

To make this service work, your Hydrogen frontends need to include source information when registering customers.

### Method 1: Using Metafields

```javascript
// In your registration form submission handler
const customerData = {
  email: formData.email,
  password: formData.password,
  firstName: formData.firstName,
  lastName: formData.lastName,
  metafields: [{
    namespace: 'customer',
    key: 'registration_source',
    value: 'STORE1', // Unique identifier for this frontend
    type: 'single_line_text_field'
  }]
};

// Send to your API endpoint that creates the customer
await createCustomer(customerData);
```

### Method 2: Using Customer Note

```javascript
// In your registration form submission handler
const customerData = {
  email: formData.email,
  password: formData.password,
  firstName: formData.firstName,
  lastName: formData.lastName,
  note: `Registered from: STORE1` // Include source in note
};

// Send to your API endpoint that creates the customer
await createCustomer(customerData);
```

## Testing

This repository includes a test script that simulates a Shopify webhook:

1. Create a `.env` file based on `.env.example`
2. Run: `node test-webhook.js [instance_id]`

Example: `node test-webhook.js store1`

## Maintenance and Monitoring

- Monitor your Netlify function logs for any errors
- Periodically review the tags being applied in Shopify
- If adding new Hydrogen frontends, update the environment variables accordingly

## Troubleshooting

If tags are not being applied correctly:

1. Check Netlify function logs for errors
2. Verify the webhook is correctly set up in Shopify
3. Ensure your frontend is correctly including source information
4. Confirm your Admin API token has the right permissions
5. Test with the included test script to verify functionality

## Security Considerations

- Rotate your Admin API token and webhook secret periodically
- Never hardcode sensitive information in your code
- Use the minimum required permissions for your Admin API token
- All webhook requests are validated with HMAC signatures

## License

This project is for your internal use and is not licensed for redistribution.