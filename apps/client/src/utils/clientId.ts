// Persistent client ID for detecting reconnections
// This ID survives page reloads and is used to identify the same player across sessions

const CLIENT_ID_KEY = 'voxel_strike_client_id';

/**
 * Generates a UUID v4
 */
function generateUUID(): string {
  // Use crypto.randomUUID if available (modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Gets the persistent client ID, creating one if it doesn't exist.
 * This ID is stored in localStorage and survives page reloads.
 */
export function getClientId(): string {
  let clientId = localStorage.getItem(CLIENT_ID_KEY);
  
  if (!clientId) {
    clientId = generateUUID();
    localStorage.setItem(CLIENT_ID_KEY, clientId);
    console.log('Generated new client ID:', clientId);
  }
  
  return clientId;
}

/**
 * Clears the client ID (useful for testing or when user wants to reset identity)
 */
export function clearClientId(): void {
  localStorage.removeItem(CLIENT_ID_KEY);
}

