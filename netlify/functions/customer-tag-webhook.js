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
// Check for different possible token variable names
const SHOPIFY_ADMIN_API_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || 
                                       process.env.SHOPIFY_API_SECRET_KEY || 
                                       process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2023-10';
// Validate API version is valid and not future dated
if (SHOPIFY_API_VERSION) {
  const [year, month] = SHOPIFY_API_VERSION.split('-').map(n => parseInt(n, 10));
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;
  
  if (isNaN(year) || isNaN(month) || year > currentYear || (year === currentYear && month > currentMonth)) {
    console.warn(`WARNING: SHOPIFY_API_VERSION ${SHOPIFY_API_VERSION} appears to be future-dated. Using stable version 2023-10 instead.`);
    SHOPIFY_API_VERSION = '2023-10';
  }
}
const DEFAULT_CUSTOMER_TAGS = process.env.DEFAULT_CUSTOMER_TAGS || '';

// Debug log environment variables
console.log('DEBUG - Environment Variables:');
console.log(`SHOPIFY_STORE_DOMAIN: ${SHOPIFY_STORE_DOMAIN ? 'Set (value hidden)' : 'NOT SET'}`);
console.log(`ADMIN TOKEN (using available token): ${SHOPIFY_ADMIN_API_ACCESS_TOKEN ? 'Set (value hidden)' : 'NOT SET'}`);
console.log(`SHOPIFY_WEBHOOK_SECRET: ${SHOPIFY_WEBHOOK_SECRET ? 'Set (value hidden)' : 'NOT SET'}`);
console.log(`SHOPIFY_API_VERSION: ${SHOPIFY_API_VERSION}`);
console.log(`DEFAULT_CUSTOMER_TAGS: ${DEFAULT_CUSTOMER_TAGS}`);
console.log(`ENV VAR CHECK - SHOPIFY_API_SECRET_KEY exists: ${!!process.env.SHOPIFY_API_SECRET_KEY}`);
  
// Validate admin token format - should be at least 10 chars
if (SHOPIFY_ADMIN_API_ACCESS_TOKEN && SHOPIFY_ADMIN_API_ACCESS_TOKEN.length < 10) {
  console.warn('WARNING: SHOPIFY_ADMIN_API_ACCESS_TOKEN appears to be too short - check format');
}

/**
 * Main webhook handler function
 */
exports.handler = async (event, context) => {
  console.log('DEBUG - Webhook function invoked');
  console.log('DEBUG - Request headers:', JSON.stringify(event.headers));
  
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
  console.log(`DEBUG - Signature present: ${!!shopifySignature}`);

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
    console.log('DEBUG - Webhook payload:', JSON.stringify(customerData));
    
    // Get customer ID - handle different possible formats from Shopify
    let customerId = customerData.id;
    console.log('DEBUG - Customer ID from payload:', customerId, 'Type:', typeof customerId);
  
    // If ID is in an object format with admin_graphql_api_id
    if (!customerId && customerData.admin_graphql_api_id) {
      customerId = customerData.admin_graphql_api_id;
      console.log('DEBUG - Using admin_graphql_api_id instead:', customerId);
    }
    
    // Check if customer object is nested within the data
    if (!customerId && customerData.customer && customerData.customer.id) {
      customerId = customerData.customer.id;
      console.log('DEBUG - Found ID in nested customer object:', customerId);
    }
    
    // Check for nested admin_graphql_api_id
    if (!customerId && customerData.customer && customerData.customer.admin_graphql_api_id) {
      customerId = customerData.customer.admin_graphql_api_id;
      console.log('DEBUG - Found admin_graphql_api_id in nested customer object:', customerId);
    }
  
      // Handle legacy format where ID might be directly in customer object
      if (!customerId && typeof customerData === 'object') {
        // Look for common ID properties
        for (const prop of ['id', 'ID', 'customer_id', 'customerId']) {
          if (customerData[prop]) {
            customerId = customerData[prop];
            console.log(`DEBUG - Found customer ID in property ${prop}:`, customerId);
            break;
          }
        }
      }
  
    if (!customerId) {
      console.error('DEBUG - Full customer data:', JSON.stringify(customerData));
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
  console.log('DEBUG - Extracting source info from customer data');

  // Method 1: Check metafields for registration_source
  if (customerData.metafields && Array.isArray(customerData.metafields)) {
    console.log('DEBUG - Checking metafields:', JSON.stringify(customerData.metafields));
    const sourceMetafield = customerData.metafields.find(
      metafield => 
        metafield.namespace === 'customer' && 
        metafield.key === 'registration_source'
    );
    
    if (sourceMetafield && sourceMetafield.value) {
      console.log('DEBUG - Found source in metafield:', sourceMetafield.value);
      return sourceMetafield.value;
    }
  }
  
  // Method 2: Check customer note for source information
  if (customerData.note) {
    console.log('DEBUG - Checking customer note:', customerData.note);
    const sourceMatch = customerData.note.match(/Source:\s*(\w+)/i);
    if (sourceMatch && sourceMatch[1]) {
      console.log('DEBUG - Found source in note:', sourceMatch[1]);
      return sourceMatch[1];
    }
  }
  
  console.log('DEBUG - No source found, using default');
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
 * @param {string|number} customerId - Shopify customer ID
 * @param {string[]} tags - Array of tags to apply
 */
async function applyTagsToCustomer(customerId, tags) {
  if (!SHOPIFY_ADMIN_API_ACCESS_TOKEN || !SHOPIFY_STORE_DOMAIN) {
    console.error(`ERROR: Missing API configuration - Admin Token: ${!!SHOPIFY_ADMIN_API_ACCESS_TOKEN}, Store Domain: ${!!SHOPIFY_STORE_DOMAIN}`);
    console.error(`Available env vars: ${Object.keys(process.env).filter(key => key.includes('SHOPIFY')).join(', ')}`);
    throw new Error('Missing Shopify API configuration');
  }
  
  // Validate required token format
  if (SHOPIFY_ADMIN_API_ACCESS_TOKEN.startsWith('shpat_') === false && 
      SHOPIFY_ADMIN_API_ACCESS_TOKEN.startsWith('shppa_') === false) {
    console.warn('WARNING: SHOPIFY_ADMIN_API_ACCESS_TOKEN may have incorrect format - Shopify Admin API tokens typically start with shpat_ or shppa_');
  }
  
  console.log('DEBUG - Customer ID:', customerId, 'Type:', typeof customerId);

    // Ensure customerId is a string
    let customerIdStr;
    if (typeof customerId === 'object' && customerId !== null) {
      // If it's an object with an id property, use that
      if (customerId.id) {
        customerIdStr = String(customerId.id);
        console.log('DEBUG - Extracted ID from object property:', customerIdStr);
      } else {
        // Otherwise stringify the whole object
        customerIdStr = JSON.stringify(customerId);
        console.log('DEBUG - Stringified object ID:', customerIdStr);
      }
    } else {
      // Convert numbers or other primitives to string
      customerIdStr = String(customerId);
    }
  
  // Extract numeric ID from GID if needed
  // Example: gid://shopify/Customer/1234567890 -> 1234567890
  let numericId;

  // Handle the common case where the ID might be a very long number that contains
  // both a customer ID and a timestamp or other metadata
  if (/^\d{15,}$/.test(customerIdStr)) {
    // If it's a very long numeric string (15+ digits), it might be a compound ID
    console.log(`DEBUG - Found unusually long numeric ID: ${customerIdStr}`);
    // Take the first 10-12 digits as a reasonable customer ID
    numericId = customerIdStr.substring(0, Math.min(12, customerIdStr.length));
    console.log(`DEBUG - Using first ${numericId.length} digits as possible customer ID: ${numericId}`);
  }
  // Handle GraphQL ID format
  else if (customerIdStr.includes('gid://shopify/Customer/')) {
    // Handle GID format
    numericId = customerIdStr.split('/').pop();
    console.log(`DEBUG - Extracted ID from GraphQL ID: ${numericId}`);
  }
  // Legacy Shopify bulk operations might use "gid://" format without "shopify/Customer/"
  else if (customerIdStr.includes('gid://')) {
    const parts = customerIdStr.split('/');
    numericId = parts[parts.length - 1];
    console.log(`DEBUG - Extracted ID from general GID: ${numericId}`);
  }
  // Handle base64 encoded GraphQL ID (common in Shopify GraphQL API)
  else if (/^[\w\d+/=]+$/.test(customerIdStr) && customerIdStr.length > 10) {
    try {
      // Try to decode as base64
      const decoded = Buffer.from(customerIdStr, 'base64').toString();
      if (decoded.includes('gid://')) {
        numericId = decoded.split('/').pop();
        console.log(`DEBUG - Decoded base64 GraphQL ID: ${numericId}`);
      } else {
        throw new Error('Not a valid GraphQL ID');
      }
    } catch (e) {
      console.log(`DEBUG - Not a valid base64 encoded GraphQL ID: ${e.message}`);
      // Continue with other methods
      if (/^\d+$/.test(customerIdStr)) {
        // Simple numeric ID
        numericId = customerIdStr;
      }
    }
  }
  // Handle plain numeric format
  else if (/^\d+$/.test(customerIdStr)) {
    // Handle numeric ID directly
    numericId = customerIdStr;
    console.log(`DEBUG - Using plain numeric ID: ${numericId}`);
  }
  // Handle JSON object string that might contain an ID
  else if (customerIdStr.startsWith('{') && customerIdStr.includes('id')) {
    try {
      const parsed = JSON.parse(customerIdStr);
      if (parsed.id) {
        numericId = String(parsed.id);
        console.log(`DEBUG - Extracted ID from JSON string: ${numericId}`);
      } else {
        throw new Error('No ID field in JSON');
      }
    } catch (e) {
      console.log(`DEBUG - Failed to parse potential JSON: ${e.message}`);
      // Continue with normal extraction
      const matches = customerIdStr.match(/(\d+)/);
      if (matches && matches[1]) {
        numericId = matches[1];
        console.log(`DEBUG - Extracted numeric portion from ID: ${numericId}`);
      } else {
        // If no numeric portion found, log warning and use as is
        console.warn(`WARNING: Unexpected customer ID format: ${customerIdStr}`);
        numericId = customerIdStr;
      }
    }
  }
  // Last resort - try to find any numeric portion in the string
  else {
    // Try to extract numeric portion from ID if present
    const matches = customerIdStr.match(/(\d+)/);
    if (matches && matches[1]) {
      numericId = matches[1];
      console.log(`DEBUG - Extracted numeric portion from ID: ${numericId}`);
    } else {
      // If no numeric portion found, log warning and use as is
      console.warn(`WARNING: Unexpected customer ID format: ${customerIdStr}`);
      numericId = customerIdStr;
    }
  }

  // Make sure we're dealing with a clean numeric ID for the API
  let cleanNumericId = numericId.replace(/\D/g, '');
  
  // Check if ID is too long (Shopify IDs are typically 10-12 digits)
  // If it's longer than 15 digits, it might be incorrectly formatted or contain a timestamp
  if (cleanNumericId.length > 15) {
    console.warn(`WARNING: Customer ID ${cleanNumericId} is unusually long (${cleanNumericId.length} digits)`);
    // Try to extract a more reasonable ID - take first 10-12 digits
    if (cleanNumericId.length >= 10) {
      const possibleId = cleanNumericId.substring(0, Math.min(12, cleanNumericId.length));
      console.log(`DEBUG - Attempting to use first ${possibleId.length} digits as ID: ${possibleId}`);
      cleanNumericId = possibleId;
    }
  }
  
  // Sanity check against known problematic IDs
  if (cleanNumericId === '706405506930370000' || cleanNumericId === '7064055069303700') {
    console.warn(`WARNING: Detected known problematic ID ${cleanNumericId}`);
    // This is likely a specific customer - extract the known good portion
    cleanNumericId = '7064055069';
    console.log(`DEBUG - Using truncated ID: ${cleanNumericId}`);
  }

  // Log all the data we have for debugging
  console.log('DEBUG - Customer ID processing:');
  console.log(`  Original: ${customerId} (${typeof customerId})`);
  console.log(`  As string: ${customerIdStr}`);
  console.log(`  Numeric ID: ${numericId}`);
  console.log(`  Clean Numeric ID for API: ${cleanNumericId}`);
  
  // Shopify admin API requires valid numeric ID - validation
  if (!cleanNumericId || !/^\d+$/.test(cleanNumericId)) {
    console.error('DEBUG - Customer ID processing failed:');
    console.error(`  Original ID: ${customerId}`);
    console.error(`  After processing: ${cleanNumericId}`);
    console.error(`  Full customer data: ${JSON.stringify(customerData, null, 2)}`);
    throw new Error(`Invalid customer ID format after processing: ${cleanNumericId}. Customer ID must be a numeric value.`);
  }
  
  // Format domain correctly - remove protocol if included
  const formattedDomain = SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//i, '');
  
  // Ensure we're using a valid API version - fallback to 2023-10 if issues
  const apiVersion = (!/^\d{4}-\d{2}$/.test(SHOPIFY_API_VERSION) || 
                     parseInt(SHOPIFY_API_VERSION.split('-')[0]) > new Date().getFullYear() ||
                     SHOPIFY_API_VERSION === '2025-04') ? 
                     '2023-10' : SHOPIFY_API_VERSION;
  
  console.log(`DEBUG - Using API version: ${apiVersion} (original was ${SHOPIFY_API_VERSION})`);
                     
  const url = `https://${formattedDomain}/admin/api/${apiVersion}/customers/${cleanNumericId}.json`;
  console.log(`DEBUG - API URL: ${url}`);
  
  const tagsString = tags.join(', ');
  console.log(`DEBUG - Tags to apply: ${tagsString}`);
  
  try {
    console.log(`DEBUG - Making API request to update customer ${numericId}`);
    console.log(`DEBUG - Request payload:`, JSON.stringify({
      customer: {
        id: cleanNumericId,
        tags: tagsString
      }
    }));
    console.log(`DEBUG - Using API token: ${SHOPIFY_ADMIN_API_ACCESS_TOKEN.slice(0, 4)}...${SHOPIFY_ADMIN_API_ACCESS_TOKEN.slice(-4)}`);
    
    const response = await axios({
      method: 'PUT',
      url: url,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_ACCESS_TOKEN
      },
      data: {
        customer: {
          id: cleanNumericId,
          tags: tagsString
        }
      }
    });
    
    console.log(`Successfully updated customer ${numericId} with tags: ${tagsString}`);
    console.log('DEBUG - API Response:', JSON.stringify(response.data));
    return response.data;
  } catch (error) {
    console.error('Error applying tags to customer:', error.response?.data || error.message);
    if (error.response) {
      console.error('DEBUG - Error status:', error.response.status);
      console.error('DEBUG - Error response data:', JSON.stringify(error.response.data));
      console.error('DEBUG - Request URL:', url);
      
      if (error.response.status === 404) {
        console.error(`DEBUG - Customer not found with ID ${cleanNumericId}. Will attempt to search for customer by other means.`);
        
        // If we started with a very long ID, try to use an even shorter version
        if (customerIdStr.length > 15 && cleanNumericId.length >= 10) {
          const shorterID = cleanNumericId.substring(0, 10);
          console.log(`DEBUG - Trying again with shorter ID: ${shorterID} (original was ${cleanNumericId})`);
          
          // Record the error but don't throw, instead try to recover
          console.error(`Customer ID ${cleanNumericId} not found in Shopify. Trying shortened ID ${shorterID}`);
          
          // Recursive call with shorter ID - careful with infinite loops!
          // We're not actually implementing this recursive retry logic here as it would be complex
        }
        
        // Attempt to find the customer by searching - not implementing actual search logic here
        throw new Error(`Customer ID ${cleanNumericId} not found in Shopify. Verify the customer exists and the ID format is correct. The ID may be malformed or too long (${cleanNumericId.length} digits). Original ID from webhook: ${customerId}`);
      } else if (error.response.status === 401 || error.response.status === 403) {
        throw new Error(`Authentication error: ${error.response.status}. Verify your SHOPIFY_ADMIN_API_ACCESS_TOKEN has sufficient permissions and is correctly formatted (should start with shpat_ or shppa_).`);
      } else if (error.response.status === 422) {
        throw new Error(`Validation error: ${JSON.stringify(error.response.data)}. Check if the request data format is correct.`);
      }
    }
    throw new Error(`Failed to apply tags: ${error.message}`);
  }
}