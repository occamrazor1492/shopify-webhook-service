// commerceplate/shopify-webhook-service/netlify/functions/customer-tag-webhook.js
const crypto = require('crypto');
const axios = require('axios');

// Constants
const SIGNATURE_HEADER = 'x-shopify-hmac-sha256';
const TOPIC_HEADER = 'x-shopify-topic';
const DOMAIN_HEADER = 'x-shopify-shop-domain';
const CUSTOMER_CREATE_TOPIC = 'customers/create';

// Configuration from environment variables
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_API_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2023-10';
const DEFAULT_CUSTOMER_TAGS = process.env.DEFAULT_CUSTOMER_TAGS || '';

/**
 * Main webhook handler function
 */
exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Validate Shopify webhook
  const shopifySignature = event.headers[SIGNATURE_HEADER] || event.headers[SIGNATURE_HEADER.toLowerCase()];
  const shopifyTopic = event.headers[TOPIC_HEADER] || event.headers[TOPIC_HEADER.toLowerCase()];
  const shopDomain = event.headers[DOMAIN_HEADER] || event.headers[DOMAIN_HEADER.toLowerCase()];
  
  // Log request information (for debugging)
  console.log(`Received webhook: ${shopifyTopic} from ${shopDomain}`);

  // Validate request signature
  if (!isValidShopifyWebhook(event.body, shopifySignature)) {
    console.error('Invalid webhook signature');
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Invalid webhook signature' })
    };
  }

  // Only process customer creation events
  if (shopifyTopic !== CUSTOMER_CREATE_TOPIC) {
    console.log(`Ignoring non-customer creation webhook: ${shopifyTopic}`);
    return {
      statusCode: 202,
      body: JSON.stringify({ message: 'Webhook received but not processed (not a customer creation event)' })
    };
  }

  try {
    // Parse customer data from webhook payload
    const customerData = JSON.parse(event.body);
    
    // Get customer ID
    const customerId = customerData.id;
    if (!customerId) {
      throw new Error('Customer ID missing from webhook data');
    }

    // Extract source information
    const sourceInfo = extractSourceInfo(customerData);
    console.log(`Identified source: ${sourceInfo}`);

    // Get appropriate tags for this source
    const tagsToApply = getTagsForSource(sourceInfo);
    console.log(`Tags to apply: ${tagsToApply}`);

    // Apply tags to customer
    if (tagsToApply.length > 0) {
      await applyTagsToCustomer(customerId, tagsToApply);
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'Success', 
          customerId: customerId,
          source: sourceInfo,
          tagsApplied: tagsToApply
        })
      };
    } else {
      console.log('No tags to apply.');
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'No tags applied', 
          customerId: customerId,
          source: sourceInfo
        })
      };
    }
  } catch (error) {
    console.error('Error processing webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error', 
        message: error.message 
      })
    };
  }
};

/**
 * Validates the Shopify webhook signature
 * @param {string} body - Request body
 * @param {string} signature - HMAC signature from Shopify
 * @returns {boolean} - Whether the signature is valid
 */
function isValidShopifyWebhook(body, signature) {
  if (!SHOPIFY_WEBHOOK_SECRET || !signature) {
    return false;
  }

  const hmac = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('base64');
  
  return crypto.timingSafeEqual(
    Buffer.from(hmac),
    Buffer.from(signature)
  );
}

/**
 * Extracts the source identifier from customer data
 * @param {Object} customerData - Customer data from webhook
 * @returns {string} - Source identifier or 'default' if not found
 */
function extractSourceInfo(customerData) {
  // Method 1: Check metafields for registration_source
  if (customerData.metafields && Array.isArray(customerData.metafields)) {
    const sourceMetafield = customerData.metafields.find(
      metafield => 
        metafield.namespace === 'customer' && 
        metafield.key === 'registration_source'
    );
    
    if (sourceMetafield && sourceMetafield.value) {
      return sourceMetafield.value;
    }
  }
  
  // Method 2: Check customer note for source information
  if (customerData.note) {
    const sourceMatch = customerData.note.match(/Source:\s*(\w+)/i);
    if (sourceMatch && sourceMatch[1]) {
      return sourceMatch[1];
    }
  }
  
  // Default if no source info found
  return 'default';
}

/**
 * Gets the appropriate tags for a given source
 * @param {string} source - Source identifier
 * @returns {string[]} - Array of tags to apply
 */
function getTagsForSource(source) {
  const tags = [];
  
  // Add default tags for all customers
  if (DEFAULT_CUSTOMER_TAGS) {
    tags.push(...DEFAULT_CUSTOMER_TAGS.split(',').map(tag => tag.trim()));
  }
  
  // Add source-specific tags if they exist
  const sourceTagsEnvVar = `CUSTOMER_TAGS_${source.toUpperCase()}`;
  const sourceTags = process.env[sourceTagsEnvVar];
  
  if (sourceTags) {
    tags.push(...sourceTags.split(',').map(tag => tag.trim()));
  }
  
  // Remove duplicates
  return [...new Set(tags)];
}

/**
 * Apply tags to a customer using Shopify Admin API
 * @param {string} customerId - Shopify customer ID
 * @param {string[]} tags - Array of tags to apply
 */
async function applyTagsToCustomer(customerId, tags) {
  if (!SHOPIFY_ADMIN_API_ACCESS_TOKEN || !SHOPIFY_STORE_DOMAIN) {
    throw new Error('Missing Shopify API configuration');
  }

  // Extract numeric ID from GID if needed
  // Example: gid://shopify/Customer/1234567890 -> 1234567890
  const numericId = customerId.includes('gid://shopify/Customer/') 
    ? customerId.split('/').pop() 
    : customerId;

  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/customers/${numericId}.json`;
  
  const tagsString = tags.join(', ');
  
  try {
    const response = await axios({
      method: 'PUT',
      url: url,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_ACCESS_TOKEN
      },
      data: {
        customer: {
          id: numericId,
          tags: tagsString
        }
      }
    });
    
    console.log(`Successfully updated customer ${numericId} with tags: ${tagsString}`);
    return response.data;
  } catch (error) {
    console.error('Error applying tags to customer:', error.response?.data || error.message);
    throw new Error(`Failed to apply tags: ${error.message}`);
  }
}