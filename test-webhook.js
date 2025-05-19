#!/usr/bin/env node

/**
 * Test script for Shopify webhook handler
 * 
 * Usage: 
 * 1. Create a .env file based on .env.example
 * 2. Run: node test-webhook.js [instance_id]
 * 
 * Example: node test-webhook.js store1
 * 
 * This script simulates a Shopify customer creation webhook to test the 
 * customer-tag-webhook function.
 */

require('dotenv').config();
const crypto = require('crypto');
const axios = require('axios');

// Configuration
const webhookUrl = process.env.WEBHOOK_URL || 'http://localhost:8888/.netlify/functions/customer-tag-webhook';
const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
const shopifyStoreDomain = process.env.SHOPIFY_STORE_DOMAIN || 'test-store.myshopify.com';
const shopifyApiVersion = process.env.SHOPIFY_API_VERSION || '2023-10';
const instanceId = process.argv[2] || 'default';

// Validate config
if (!webhookSecret) {
  console.error('Error: SHOPIFY_WEBHOOK_SECRET is missing in .env file');
  process.exit(1);
}

// Create test customer data
const customerId = `gid://shopify/Customer/${Math.floor(Math.random() * 1000000)}`;
const customerData = {
  id: customerId,
  email: `test-${instanceId}-${Date.now()}@example.com`,
  first_name: 'Test',
  last_name: `User-${instanceId}`,
  phone: '+1234567890',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  accepts_marketing: false,
  verified_email: true,
  addresses: [],
  
  // Method 1: Include source as metafield
  metafields: [
    {
      namespace: 'customer',
      key: 'registration_source',
      value: instanceId,
      type: 'single_line_text_field'
    }
  ],
  
  // Method 2: Include source in note
  note: `Test customer created for webhook testing. Source: ${instanceId}`
};

// Generate Shopify-compatible HMAC signature
function generateShopifyHmac(data, secret) {
  const jsonData = JSON.stringify(data);
  return crypto
    .createHmac('sha256', secret)
    .update(jsonData, 'utf8')
    .digest('base64');
}

// Send the test webhook
async function sendTestWebhook() {
  console.log(`🚀 Sending test webhook to ${webhookUrl}`);
  console.log(`📦 Testing with instanceId: ${instanceId}`);
  
  // Convert data to JSON string
  const jsonData = JSON.stringify(customerData);
  
  // Generate signature
  const hmacSignature = generateShopifyHmac(customerData, webhookSecret);
  
  try {
    console.log(`📝 Sending customer data for ID: ${customerId}`);
    console.log(`📌 Using webhook URL: ${webhookUrl}`);
    
    // Make the request
    const response = await axios({
      method: 'POST',
      url: webhookUrl,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Topic': 'customers/create',
        'X-Shopify-Hmac-SHA256': hmacSignature,
        'X-Shopify-Shop-Domain': shopifyStoreDomain,
        'X-Shopify-API-Version': shopifyApiVersion
      },
      data: jsonData
    });
    
        // Display results
        console.log(`✅ Response status: ${response.status}`);
        console.log('📄 Response data:');
        console.log(JSON.stringify(response.data, null, 2));
    
        // Show what tags would have been applied
        if (response.data && response.data.tagsApplied) {
          console.log(`🏷️ Tags applied: ${response.data.tagsApplied.join(', ')}`);
        }
    
  } catch (error) {
    console.error('❌ Error sending webhook:');
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error(`Status: ${error.response.status}`);
      console.error('Response data:', error.response.data);
      
      if (error.response.status === 401) {
        console.error('💡 Tip: Check that your SHOPIFY_WEBHOOK_SECRET is correct in .env');
      } else if (error.response.status === 500) {
        console.error('💡 Tip: Check the Netlify function logs for more details');
      }
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received from server');
      console.error('💡 Tip: Make sure your Netlify dev server is running with "npm run dev"');
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error:', error.message);
    }
  }
}

// Run the test
sendTestWebhook();