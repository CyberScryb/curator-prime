export async function generateProvenanceHash(itemData: any, imageBase64: string): Promise<string> {
  const dataString = `${itemData.itemName || ''}${itemData.era || ''}${itemData.classification || ''}${imageBase64 || ''}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(dataString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return '0x' + hashHex;
}
