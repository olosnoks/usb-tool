/**
 * Curated IEEE OUI Vendor Database & Lookup Utility
 * Fast, lightweight vendor mapping (<150 entries) for Wi-Fi client and AP reconnaissance.
 */

export const OUI_DATABASE = {
  // Google
  '001A11': 'Google',
  'F4F5E8': 'Google',
  'D86C63': 'Google',
  '94EB2C': 'Google',
  'A47733': 'Google',

  // Apple
  '0017F2': 'Apple',
  '000393': 'Apple',
  '000A95': 'Apple',
  '001C42': 'Apple',
  '002500': 'Apple',
  '3C22FB': 'Apple',
  'ACBC32': 'Apple',
  'F01898': 'Apple',
  '70DEE2': 'Apple',
  '88665A': 'Apple',
  'A483E7': 'Apple',
  'DC2B61': 'Apple',

  // Intel
  '001302': 'Intel',
  '001500': 'Intel',
  '8086F2': 'Intel',
  'A44CC8': 'Intel',
  '001B77': 'Intel',
  '0024D7': 'Intel',
  '4C796E': 'Intel',
  'C85B76': 'Intel',

  // Espressif (ESP8266 / ESP32 IoT)
  '246F28': 'Espressif',
  '30AEA4': 'Espressif',
  '84CCA8': 'Espressif',
  'A020A6': 'Espressif',
  '240AC4': 'Espressif',
  '244CAB': 'Espressif',
  '308398': 'Espressif',
  '3C71BF': 'Espressif',
  'B4E62D': 'Espressif',
  'CC50E3': 'Espressif',

  // Raspberry Pi
  'B827EB': 'Raspberry Pi',
  'DCA632': 'Raspberry Pi',
  'E45F01': 'Raspberry Pi',
  '28CDC9': 'Raspberry Pi',

  // Samsung
  '0012FB': 'Samsung',
  '342387': 'Samsung',
  '5001D9': 'Samsung',
  '0007AB': 'Samsung',
  '00166C': 'Samsung',
  '002119': 'Samsung',
  '002637': 'Samsung',

  // Cisco / Meraki
  '004096': 'Cisco',
  '000142': 'Cisco',
  '000196': 'Cisco',
  '000573': 'Cisco',
  '0008E3': 'Cisco',
  '00180A': 'Cisco',
  '0C8DDB': 'Cisco',

  // TP-Link
  '0014D1': 'TP-Link',
  '50C7BF': 'TP-Link',
  '0019E0': 'TP-Link',
  '002586': 'TP-Link',
  '14CC20': 'TP-Link',
  '30B5C2': 'TP-Link',
  '54AF97': 'TP-Link',
  'C006C3': 'TP-Link',

  // Ubiquiti Networks
  '002722': 'Ubiquiti',
  '0418D6': 'Ubiquiti',
  '24A43C': 'Ubiquiti',
  '687251': 'Ubiquiti',
  '788A20': 'Ubiquiti',
  'B4FBE4': 'Ubiquiti',
  'DC9FDB': 'Ubiquiti',
  'F09FC2': 'Ubiquiti',

  // Netgear
  '000FB5': 'Netgear',
  '00146C': 'Netgear',
  '00184D': 'Netgear',
  '001B2F': 'Netgear',
  '0024B2': 'Netgear',
  '204E7F': 'Netgear',
  '841B5E': 'Netgear',

  // Huawei
  '001882': 'Huawei',
  '001E10': 'Huawei',
  '00259E': 'Huawei',
  '00E0FC': 'Huawei',
  '4846FB': 'Huawei',

  // Tuya / Smart Life IoT
  'D81F12': 'Tuya',
  '10D561': 'Tuya',
  '68572D': 'Tuya',
  '708976': 'Tuya',
  'A09208': 'Tuya',

  // Amazon (Echo, Ring, Blink)
  '00FC8B': 'Amazon',
  '0C47C9': 'Amazon',
  '18742E': 'Amazon',
  '34D270': 'Amazon',
  '40B4CD': 'Amazon',
  '44650D': 'Amazon',
  'AC63BE': 'Amazon',

  // Philips Hue
  '001788': 'Philips Hue',
  'ECB5FA': 'Philips Hue',

  // Realtek
  '001A2B': 'Realtek',
  '00E04C': 'Realtek',
  '00072F': 'Realtek',

  // Alfa Network
  '00C0CA': 'Alfa Network',

  // MikroTik
  '000C42': 'MikroTik',
  '2C6B7D': 'MikroTik',
  '488AD2': 'MikroTik',
  '64D154': 'MikroTik',
  'B869F4': 'MikroTik',

  // ASUS
  '000C6E': 'ASUS',
  '0011D8': 'ASUS',
  '0018F3': 'ASUS',
  '001E8C': 'ASUS',
  '04D9F5': 'ASUS',

  // Aruba / HPE
  '000B86': 'Aruba / HPE',
  '001A1E': 'Aruba / HPE',
  '24DEC6': 'Aruba / HPE',

  // D-Link
  '00055D': 'D-Link',
  '000D88': 'D-Link',
  '0015E9': 'D-Link',
  '001B11': 'D-Link',

  // Microsoft
  '000D3A': 'Microsoft',
  '00155D': 'Microsoft',
  '0017FA': 'Microsoft',
  '281878': 'Microsoft',

  // Sony
  '00014A': 'Sony',
  '000D18': 'Sony',
  '0015C1': 'Sony',
  '001A80': 'Sony',

  // Dell
  '00065B': 'Dell',
  '000874': 'Dell',
  '001422': 'Dell',

  // HP
  '0001E6': 'HP',
  '000802': 'HP',
  '00110A': 'HP'
};

/**
 * Resolves MAC address to hardware manufacturer name.
 * Strips colons/dashes/spaces, extracts the 6-character prefix, and returns the vendor.
 * 
 * @param {string} macAddress - e.g. "00:1A:11:XX:XX:XX" or "001A11223344"
 * @returns {string} Mapped vendor name or "Unknown"
 */
export function getVendor(macAddress) {
  if (!macAddress || typeof macAddress !== 'string') {
    return 'Unknown';
  }
  const clean = macAddress.replace(/[:\-\.\s]/g, '').toUpperCase();
  if (clean.length < 6) {
    return 'Unknown';
  }
  const prefix = clean.slice(0, 6);
  return OUI_DATABASE[prefix] || 'Unknown';
}
