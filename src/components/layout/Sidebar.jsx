import React, { useState } from 'react';
import { searchTools } from '../../utils/toolSearch';
import { 
  Terminal, 
  HardDrive, 
  Sliders, 
  Binary, 
  Activity, 
  Layers, 
  ArrowLeftRight, 
  Navigation, 
  FileCode, 
  Wifi, 
  Gauge, 
  Compass, 
  ShieldAlert, 
  Bot, 
  Usb, 
  HelpCircle, 
  Cpu, 
  BookOpen, 
  Search, 
  ChevronLeft, 
  ChevronRight,
  Flame,
  Radio,
  Sparkles,
  Zap,
  ShieldCheck,
  Keyboard,
  Download,
  Bluetooth,
  Smartphone,
  Camera,
  KeyRound,
  ScrollText,
  MapPin,
  Database,
  Network,
  Regex,
  Calculator,
  Hash,
  Radar,
  Link2,
  ScanSearch
} from 'lucide-react';

import { windowKeyFor } from '../../utils/windowManager';

export const SIDEBAR_SECTIONS = [
  {
    id: 'core',
    title: 'CORE OPERATIONS',
    items: [
      { id: 'terminal', name: 'Terminal & Console', icon: Terminal, accent: 'cyan', desc: 'Real-time serial log & baud hunter', keywords: ['console', 'uart', 'baud', 'serial', 'com', 'monitor', 'log', 'echo', 'terminal', 'putty', 'minicom', 'picocom', 'serial monitor', 'baud rate', 'autobaud', 'baud scan', 'serial terminal', 'uart console', 'serial port', 'com port', 'tty'] },
      { id: 'flasher', name: 'Firmware Flasher', icon: HardDrive, accent: 'amber', desc: 'Multi-binary partition flashing', keywords: ['esp32', 'esp8266', 'esptool', 'bin', 'rom', 'partitions', 'flash', 'bootloader', 'ota', 'flasher', 'firmware', 'firmware flash', 'flash firmware', 'write flash', 'upload firmware', 'burn', 'uf2', 'rp2040', 'esp-idf', 'bin file', 'merge bin', 'meshtastic', 'esp flasher', 'esp web tools'] },
      { id: 'hardware', name: 'Hardware Controls', icon: Sliders, accent: 'emerald', desc: 'Strapping timers, DTR/RTS, U-Boot', keywords: ['strapping', 'gpio0', 'reset', 'dtr', 'rts', 'uboot', 'bootloader', 'timers', 'hardware', 'boot mode', 'download mode', 'enter bootloader', 'hard reset', 'auto reset', 'gpio', 'dtr rts'] }
    ]
  },
  {
    id: 'analysis',
    title: 'ANALYSIS & PROTOCOL LAB',
    items: [
      { id: 'packet-analyzer', name: 'Packet & Protocol Lab', icon: Activity, accent: 'purple', desc: 'Wi-Fi 802.11, PCAP, Hex Stream & Packet Framer', keywords: ['pcap', 'hex', 'packets', 'kismet', 'wireshark', 'dissector', 'framer', 'sniff', 'raw', 'protocol', 'analyzer', 'pcapng', 'hexdump', 'hex dump', 'hex viewer', 'crc', 'checksum', 'binary framer', 'packet framer', 'rest api', 'protocol analyzer', 'packet capture', 'serial hex', 'wi-fi capture'] },
      { id: 'logic-analyzer', name: '24MHz Logic Analyzer', icon: Activity, accent: 'cyan', desc: '8-channel capture (SUMP, fx2lafw, VCD/.sr) with I2C, UART, SPI, 1-Wire, CAN, WS2812, IR & SWD decoders', keywords: ['sump', 'fx2lafw', 'sigrok', 'vcd', 'sr', '8-channel', 'i2c', 'uart', 'spi', '1-wire', 'can', 'ws2812', 'ir', 'swd', 'logic', 'analyzer', 'saleae', 'pulseview', 'logic analyser', 'protocol decoder', 'digital capture', 'spi decoder', 'i2c decoder', 'uart decoder', 'neopixel', 'infrared decoder', '1wire'] },
      { id: 'can-bus', name: 'CAN Bus & OBD-II Scanner', icon: Gauge, accent: 'emerald', desc: 'Sniffer with DBC decoding, replay, OBD-II and UDS diagnostics', keywords: ['can', 'obd', 'obd2', 'obd-ii', 'dbc', 'automotive', 'uds', 'vehicle', 'car', 'elm327', 'replay', 'bus', 'slcan', 'canable', 'candump', 'can sniffer', 'can bus', 'canbus', 'isotp', 'dtc', 'diagnostic trouble codes', 'ecu', 'dbc file', 'car hacking', 'obd2 scanner'] },
      { id: 'bus-explorer', name: 'I2C & SPI Bus Explorer', icon: Cpu, accent: 'emerald', desc: 'I2C scan, registers, live sensor readouts, OLED test and SPI flash dumps via Bus Pirate', keywords: ['bus pirate', 'i2c', 'spi', 'scan', 'registers', 'sensors', 'oled', 'eeprom', 'flash dump', 'explorer', 'buspirate', 'spi flash', 'i2c scanner', 'i2c scan', 'i2c sensor', 'spi dump', 'flash dumper', 'eeprom reader'] },
      { id: 'modbus-rtu', name: 'Modbus RTU & RS-485', icon: Activity, accent: 'amber', desc: 'Industrial holding registers & inverter telemetry', keywords: ['modbus', 'rs485', 'holding registers', 'inverter', 'plc', 'scada', 'industrial', 'rtu', 'modbus rtu', 'rs-485', 'rs 485', 'register map', 'function code'] },
      { id: 'plotter', name: 'Oscilloscope Plotter', icon: Activity, accent: 'rose', desc: 'Multi-channel live waveforms', keywords: ['scope', 'oscilloscope', 'waveform', 'analog', 'adc', 'graph', 'telemetry', 'channels', 'plotter', 'serial plotter', 'arduino plotter', 'plot', 'chart', 'live graph', 'adc plot'] },
      { id: 'bridge', name: 'MitM Serial Bridge', icon: ArrowLeftRight, accent: 'cyan', desc: 'Dual-port pass-through sniffer', keywords: ['mitm', 'man in the middle', 'bridge', 'dual-port', 'pass-through', 'sniffer', 'uart', 'serial bridge', 'uart sniffer', 'uart tap', 'passthrough', 'pass through', 'serial proxy', 'intercept', 'two ports'] },
      { id: 'usbtmc', name: 'USBTMC Instrument', icon: Gauge, accent: 'cyan', desc: 'SCPI console, scope waveforms & screenshots, DMM logging and scripts over WebUSB', keywords: ['usbtmc', 'scpi', 'scope', 'multimeter', 'dmm', 'rigol', 'sigrok', 'visa', 'instrument', 'oscilloscope', 'siglent', 'keysight', 'tektronix', 'screenshot', 'waveform', 'multimeter logging', 'scpi console', 'lab instrument', 'test equipment'] },
      { id: 'cyberchef', name: 'CyberChef Workbench', icon: Sparkles, accent: 'purple', desc: 'Cyber Swiss Army Knife: 200+ crypto, encoding, compression & parsing operations', keywords: ['cyberchef', 'chef', 'crypto', 'base64', 'hex', 'deobfuscate', 'magic', 'entropy', 'hash', 'recipe', 'pipeline', 'gchq', 'xor', 'rot13', 'decode', 'encode', 'encrypt', 'decrypt', 'aes', 'gzip', 'compress', 'sha3', 'hexdump', 'bake', 'data converter', 'url decode', 'deobfuscation'] }
    ]
  },
  {
    id: 'rf',
    title: 'RF, WIRELESS & BADGES',
    items: [
      { id: 'alfa-wifi', name: 'Wi-Fi Monitor (Alfa / Panda PAU09)', icon: Wifi, accent: 'cyan', desc: 'WebUSB monitor mode & 802.11 frame capture for Alfa RTL8812AU & Panda PAU09 (RT5572)', keywords: ['alfa', 'panda', 'pau09', 'rt5572', 'rtl8812au', 'monitor mode', 'wifi', 'wi-fi', '802.11', 'pcap', 'sniffer', 'injection', 'wifi-scanner', 'wifi sniffer', 'wifi monitor', 'packet injection', 'deauth', 'handshake', 'beacon', 'probe request', '802.11 capture', 'wireshark', 'usb wifi adapter', 'wifi adapter', 'channel hop', 'wifi scanner', 'scan access points', 'ssid', 'rssi'] },
      { id: 'flipper', name: 'Flipper Zero Suite', icon: Bot, accent: 'amber', desc: 'qFlipper companion: 128x64 LCD, BadUSB, Sub-GHz, NFC & SD', keywords: ['flipper', 'flipper zero', 'qflipper', 'sub-ghz', 'subghz', 'nfc', 'rfid', 'badusb', 'screen mirror', 'remote control', 'sd card', 'ibutton', 'infrared', 'sub ghz', 'storage', '125khz'] },
      { id: 'proxmark', name: 'Proxmark3 / PM5 Suite', icon: Radio, accent: 'cyan', desc: '13.56MHz & 125kHz RFID cloner, raw NG framing & WebFlash', keywords: ['proxmark', 'pm5', 'rfid', 'nfc', '13.56mhz', '125khz', 'mifare', 't5577', 'em4100', 'cloner', 'rfid-nfc', 'proxmark3', 'pm3', 'rdv4', 'mifare classic', 'ntag', 'ntag215', 'ultralight', 'icode', 'hid prox', 'wiegand', 'em410x', 't55xx', 'clone card', 'access card', 'badge clone', 'lf hf', 'hf mf', 'lf search', 'hf search', 'flash firmware'] },
      { id: 'mayhem', name: 'PortaPack Mayhem SDR', icon: Radio, accent: 'purple', desc: 'HackRF receiver: zoomable spectrum & waterfall, audio, sweep, ADS-B, IQ recorder, firmware flasher & first-time setup', keywords: ['mayhem', 'portapack', 'hackrf', 'sdr', 'spectrum', 'waterfall', 'ads-b', 'aircraft', 'iq', 'radio', 'sub-ghz', 'portapack mayhem', 'hackrf one', 'spectrum analyzer', 'adsb', 'rtl_433', 'sensor hub', 'ham radio', 'gqrx', 'iq recorder', 'replay', 'firmware flasher', 'sd card', 'frequency'] },
      { id: 'wardrive', name: 'GPS & Wardrive Suite', icon: Compass, accent: 'emerald', desc: 'Warhog CYD, Piglet, Panda PAU09, NMEA tracker & u-blox UBX', keywords: ['wardrive', 'gps', 'nmea', 'ubx', 'u-blox', 'wigle', 'mapper', 'kml', 'tracking', 'gpx', 'neo-6m', 'm8n', 'gnss', 'glonass', 'galileo', 'gps tracker', 'satellites', 'wardriving', 'wifi scanner'] },
      { id: 'warhog-piglet', name: 'Warhog CYD & Piglet Suite', icon: Sparkles, accent: 'amber', desc: 'Warhog CYD (ESP32-2432S028R) & Piglet ESP32-C5/S3 wardriver deck', keywords: ['warhog', 'piglet', 'cyd', 'cheap yellow display', 'esp32-2432s028r', 'esp32-c5', 'esp32-s3', 'sd card', 'wardriver.cfg', 'screen mirror', 'warhog-sd', 'warhog-config', 'warhog-console', 'warhog-flasher', 'warhog-pinouts', 'wardriver', 'wardriving', 'wigle csv', 'wigle.csv', 'web flasher', 'pinouts', 'config editor', 'gps uart'] },
      { id: 'wardrive-generator', name: 'Demo Wardrive Generator', icon: MapPin, accent: 'emerald', desc: 'Synthetic wardriving vector art for Kepler.gl & WiGLE (inspired by OSINTI4L)', keywords: ['demo generator', 'wardrive generator', 'kepler', 'kepler.gl', 'wigle', 'vector', 'svg', 'map art', 'osinti4l', 'synthetic', 'fake wardrive', 'geojson', 'csv', 'demo data'] },
      { id: 'ble', name: 'Bluetooth LE Explorer', icon: Bluetooth, accent: 'cyan', desc: 'Web Bluetooth GATT client: services, notify, typed writes, Nordic DFU updates', keywords: ['ble', 'bluetooth', 'gatt', 'nordic', 'dfu', 'nrf', 'nrf52', 'services', 'characteristics', 'wireless', 'web bluetooth', 'ble scanner', 'bluetooth scanner', 'bluetooth le', 'characteristic', 'notify', 'uuid', 'nrfutil', 'nordic dfu', 'nrf connect', 'hc-05', 'ble serial', 'nus', 'uart service', 'firmware update'] },
      // Wireless / crypto / packet security
      { id: 'hashcat-cracker', name: 'Hash Cracker', icon: Zap, accent: 'amber', desc: 'Dictionary, rule-based & mask attacks; MD5/SHA/NTLM/MySQL/salted modes; multi-hash potfile, live H/s & ETA, optional WebGPU for MD5 masks', keywords: ['hashcat', 'crack', 'hash', 'md5', 'sha', 'ntlm', 'mysql', 'salt', 'password', 'rules', 'mask', 'bruteforce', 'potfile', 'wordlist', 'password cracker', 'crack hash', 'hash cracker', 'md5 crack', 'sha1 crack', 'dictionary attack', 'rule', 'webgpu', 'gpu', 'brute force', 'mask attack', 'rockyou'] },
      { id: 'aircrack-wifi', name: 'WPA PMKID Cracker', icon: Wifi, accent: 'cyan', desc: 'Offline WPA/WPA2 PMKID dictionary attack', keywords: ['aircrack', 'wifi', 'wpa', 'pmkid', 'crack', 'aircrack-ng', 'wpa2', 'handshake', 'hashcat 22000', 'wifi password', 'crack wifi', 'wordlist', 'dictionary', 'psk', '4-way handshake', 'eapol'] },
      { id: 'tcpdump-viewer', name: 'PCAP Viewer', icon: ShieldAlert, accent: 'rose', desc: 'Parse and filter .pcap captures in-browser', keywords: ['tcpdump', 'pcap', 'viewer', 'packet', 'pcap viewer', 'pcapng', 'wireshark', 'tshark', 'packet capture', 'capture file', 'network capture', 'packet filter', 'analyze pcap', 'open pcap'] }
    ]
  },
  {
    id: 'webapp',
    title: 'WEB APP TESTING',
    items: [
      { id: 'http-workbench', name: 'HTTP Workbench', icon: ShieldCheck, accent: 'purple', desc: 'Repeater, Intruder, Comparer & Decoder plus an OpenAPI/Swagger API client with schema fuzzing', keywords: ['burp', 'repeater', 'intruder', 'comparer', 'decoder', 'proxy', 'http', 'https', 'request', 'web app', 'api', 'openapi', 'swagger', 'rest', 'postman', 'hoppscotch', 'endpoint', 'fuzz', 'schema', 'burp suite', 'burp-proxy', 'api-client', 'api client', 'curl', 'rest client', 'http client', 'http request', 'fuzzer', 'fuzzing', 'web proxy', 'send request', 'http repeater', 'cookies', 'basic auth', 'bearer token', 'api testing'] },
      { id: 'web-analyzer', name: 'Web Analyzer', icon: Link2, accent: 'purple', desc: 'Analyze a URL: links/resources/forms & security headers, passive header/cookie/CORS/TLS scan, and sensitive-path probing', keywords: ['web analyzer', 'url', 'link', 'analyzer', 'crawl', 'scrape', 'links', 'resources', 'forms', 'headers', 'security headers', 'meta', 'owasp', 'zap', 'passive', 'scanner', 'nikto', 'paths', 'content discovery', 'url-inspector', 'url inspector', 'nikto-scanner', 'owasp-zap', 'owasp zap', 'scan website', 'website scanner', 'vulnerability scanner', 'csp', 'cors', 'cookie flags', 'hsts', 'tls', 'robots.txt', 'sitemap', 'sensitive paths', 'dirb', 'dirbuster', 'directory brute force', 'link extractor', 'extract links'] },
      { id: 'hydra-bruteforce', name: 'HTTP Basic Auth Tester', icon: Cpu, accent: 'emerald', desc: 'Try credential lists against HTTP Basic auth', keywords: ['hydra', 'bruteforce', 'login', 'basic auth', 'http', 'credential stuffing', 'password guess', 'default credentials', 'login brute force', 'brute force', 'wordlist', 'dictionary attack', 'http auth'] },
      { id: 'nmap-scanner', name: 'Port Scanner', icon: Radio, accent: 'cyan', desc: 'Connect-timing TCP scan: toggleable port profiles + custom ports, nmap-style timing templates, concurrency, show-all & export', keywords: ['nmap', 'port scanner', 'service discovery', 'network', 'recon', 'ports', 'profiles', 'timing', 'top ports', 'scan', 'port scan', 'portscan', 'tcp scan', 'tcp connect', 'open ports', 'service scan', 'network scanner'] },
      { id: 'dns-toolkit', name: 'DNS Toolkit', icon: Network, accent: 'indigo', desc: 'One lookup: all records + email auth (SPF/DMARC/DKIM/DNSBL) together, verbose subdomain brute-force, and one-click Markdown export', keywords: ['dns', 'enumerate', 'doh', 'records', 'subdomain', 'recon', 'mail', 'mxtoolbox', 'spf', 'dmarc', 'dkim', 'dnsbl', 'blacklist', 'mx', 'txt', 'caa', 'email', 'deliverability', 'toolkit', 'dns-enumerator', 'dns enumerator', 'dns-mail-doctor', 'mail doctor', 'dig', 'nslookup', 'dns lookup', 'dns over https', 'subdomain brute force', 'subdomain enumeration', 'rbl', 'blacklist check', 'email security', 'email auth', 'mail server test', 'mx lookup', 'txt record', 'a record', 'ns record', 'markdown export'] },
      { id: 'cert-inspect', name: 'Certificate Inspector', icon: ShieldCheck, accent: 'cyan', desc: 'Inspect X.509 certs from a URL (crt.sh), file or pasted PEM — SAN, key usage, EKU, constraints, key size/curve, OCSP/CRL, fingerprints', keywords: ['certificate', 'x509', 'pem', 'der', 'tls', 'ssl', 'url', 'crt.sh', 'san', 'ocsp', 'crl', 'key usage', 'fingerprint', 'chain', 'openssl', 'openssl x509', 'certificate decoder', 'csr', 'ssl checker', 'ssl certificate', 'tls certificate', 'cert chain', 'cert info', 'pem decoder', 'expiry', 'expiration', 'subject alternative name', 'sha256 fingerprint', 'self signed'] },
      { id: 'pwned-passwords', name: 'Pwned Passwords', icon: ShieldCheck, accent: 'rose', desc: 'Check passwords against HaveIBeenPwned (k-anonymity)', keywords: ['pwned', 'hibp', 'breach', 'password', 'haveibeenpwned', 'have i been pwned', 'breached password', 'password leak', 'leaked password', 'k-anonymity', 'sha1', 'range api', 'password check', 'compromised password'] },
      { id: 'db-browser', name: 'Lite DB Browser', icon: Database, accent: 'emerald', desc: 'Open SQLite files read-only & query DB/REST endpoints (PostgREST, CouchDB, Elasticsearch, Datasette)', keywords: ['database', 'db', 'sqlite', 'sql', 'postgrest', 'couchdb', 'elasticsearch', 'datasette', 'rest', 'endpoint', 'table', 'browser', 'viewer', 'db browser for sqlite', 'sqlite3', 'sqlitebrowser', 'sqlite browser', 'sql editor', 'sql query', 'query', 'db file', '.db', '.sqlite', 'database viewer', 'open database', 'table viewer', 'schema', 'export csv', 'import csv', 'combine'] },
      { id: 'regex-tester', name: 'Regex Tester', icon: Regex, accent: 'purple', desc: 'Live regex match highlighting, capture groups & replace preview (regex101-style, fully offline)', keywords: ['regex', 'regexp', 'regular expression', 'regex101', 'match', 'capture group', 'pattern', 'replace', 'capture groups', 'test regex', 'javascript regex', 'named groups', 'lookahead', 'flags'] },
      { id: 'jwt-inspector', name: 'JWT Inspector', icon: KeyRound, accent: 'amber', desc: 'Decode JWT header/claims & verify HS/RS/ES/PS signatures with Web Crypto (jwt.io-style, offline)', keywords: ['jwt', 'jwt.io', 'json web token', 'jws', 'bearer', 'claims', 'hs256', 'rs256', 'es256', 'verify', 'signature', 'decode', 'token decoder', 'decode jwt', 'verify jwt', 'ps256', 'signature verify', 'id token', 'access token'] },
      { id: 'crtsh-finder', name: 'crt.sh Subdomain Finder', icon: Search, accent: 'emerald', desc: 'Passive subdomain enumeration from Certificate Transparency logs (crt.sh, via proxy)', keywords: ['crt.sh', 'crtsh', 'certificate transparency', 'ct logs', 'subdomain', 'enumeration', 'passive', 'recon', 'osint', 'subdomain finder', 'find subdomains', 'passive recon', 'wildcard certificate'] },
      { id: 'ip-calculator', name: 'IP / CIDR Calculator', icon: Calculator, accent: 'purple', desc: 'IPv4 & IPv6 subnet math: network, broadcast, mask, host range & counts (fully offline)', keywords: ['ip', 'cidr', 'subnet', 'netmask', 'wildcard', 'ipv4', 'ipv6', 'calculator', 'network', 'broadcast', 'range', 'ipcalc', 'subnet calculator', 'wildcard mask', 'network address', 'usable hosts', 'subnetting', 'supernet', 'ip range'] },
      { id: 'hash-calculator', name: 'Hash & HMAC Calculator', icon: Hash, accent: 'amber', desc: 'MD5 / SHA-1 / SHA-256/384/512 + HMAC for text and files via Web Crypto (fully offline)', keywords: ['hash', 'md5', 'sha', 'sha256', 'sha1', 'sha512', 'hmac', 'checksum', 'digest', 'fingerprint', 'file hash', 'md5sum', 'sha256sum', 'sha1sum', 'sha384', 'file checksum', 'verify checksum', 'hash file', 'hash text', 'web crypto', 'integrity'] },
      { id: 'osint-clients', name: 'OSINT API Clients', icon: Radar, accent: 'cyan', desc: 'Shodan, urlscan.io & HackerTarget clients — bring your own API key (via proxy)', keywords: ['osint', 'shodan', 'urlscan', 'hackertarget', 'recon', 'intelligence', 'api', 'host lookup', 'reverse ip', 'query builder', 'facets', 'exploits', 'urlscan.io', 'search engine for devices', 'internet scan', 'exposed devices', 'banner', 'shodan query', 'shodan dork', 'dork', 'port search', 'vulns', 'cve', 'exploit search', 'reverse dns', 'iot search'] },
    ]
  },
  {
    id: 'programmers',
    title: 'HARDWARE & PAYLOADS',
    items: [
      { id: 'ducky', name: 'BadUSB & Payload Studio', icon: Keyboard, accent: 'amber', desc: 'DuckyScript keystroke compiler, syntax validator & live simulator', keywords: ['ducky', 'duckyscript', 'badusb', 'rubber ducky', 'keystroke injection', 'hid', 'payload', 'payload studio', 'arduino', 'circuitpython', 'usb rubber ducky', 'bad usb', 'hid injection', 'digispark', 'arduino leonardo', 'pico ducky', 'keyboard emulation', 'compile ducky', 'simulator', 'syntax validator', 'flipper badusb'] },
      { id: 'programmers', name: 'Hardware Programmers', icon: Cpu, accent: 'cyan', desc: 'CH341A SPI flash, CMSIS-DAP debugger (RTT, SWO, flash), JTAG / SVF and AVR ISP', keywords: ['programmers', 'ch341a', 'cmsis-dap', 'cmsis', 'dap', 'swd', 'rtt', 'swo', 'jtag', 'svf', 'cpld', 'avr', 'isp', 'atmega', 'spi flash', 'bios', 'ch341a programmer', 'jtag-programmer', 'avr-isp', 'flashrom', 'bios chip', 'bios flash', '25xx', '24cxx', 'eeprom', 'soic8', 'daplink', 'usbasp', 'fuses', 'lock bits', 'stm32', 'nrf52', 'rp2040', 'debugger', 'read flash', 'dump firmware', 'firmware dump', 'write flash', 'chip programmer', 'cortex-m', 'idcode'] },
      { id: 'usb-pd', name: 'USB-PD Power Delivery', icon: Zap, accent: 'amber', desc: 'STUSB4500 sink: contract readout, voltage requests and verified NVM (power-up PDOs)', keywords: ['usb-pd', 'power delivery', 'pd', 'type-c', 'stusb4500', 'pdo', 'voltage trigger', '9v', '12v', '15v', '20v', 'e-marker', 'usb pd', 'usb-c', 'type c', 'pd sink', 'pps', 'trigger board', 'usb c power', 'fixed pdo', 'contract', 'nvm', 'emarker'] },
      { id: 'dfu', name: 'WebUSB DFU Flasher', icon: Download, accent: 'cyan', desc: 'USB DFU 1.1 & ST DfuSe firmware download: STM32, nRF & more', keywords: ['dfu', 'dfuse', 'stm32', 'bootloader', 'flash', 'firmware update', 'gd32', 'arm', 'dfu-util', 'dfu mode', 'st dfuse', 'stm32 bootloader', 'nrf dfu', 'flash stm32', 'dfu flasher', 'bootloader mode', 'dfu 1.1', 'upload bin', 'download bin', 'dfu file'] },
      { id: 'android', name: 'Android (ADB & Fastboot)', icon: Smartphone, accent: 'emerald', desc: 'One Android tool over WebUSB: ADB (device info, shell, files, apps, logcat, screen, wireless) and Fastboot (unlock, sparse flashing, A/B slots, factory zips, reboot)', keywords: ['android', 'adb', 'fastboot', 'bootloader', 'unlock', 'partitions', 'sparse', 'recovery', 'reboot', 'shell', 'logcat', 'screen mirror', 'tap', 'file manager', 'wireless adb', 'apk', 'android debug bridge', 'platform-tools', 'adb shell', 'adb push', 'adb pull', 'adb install', 'install apk', 'sideload', 'screencap', 'bootloader unlock', 'oem unlock', 'flash partition', 'a/b slots', 'factory image', 'factory zip', 'sparse image', 'reboot bootloader', 'reboot recovery', 'adb connect', 'device info', 'package list', 'getprop', 'dumpsys', 'fastboot flash'] }
    ]
  },
  {
    id: 'utilities',
    title: 'DEVICE UTILITIES',
    items: [
      { id: 'micropython', name: 'MicroPython Files', icon: FileCode, accent: 'purple', desc: 'On-chip filesystem explorer', keywords: ['micropython', 'repl', 'mip', 'files', 'ampy', 'python', 'pyboard', 'mpremote', 'rshell', 'thonny', 'upload file', 'boot.py', 'main.py', 'circuitpython', 'file manager', 'flash filesystem', 'python on esp32'] },
      { id: 'improv', name: 'Improv Wi-Fi', icon: Wifi, accent: 'emerald', desc: 'Standard serial Wi-Fi provisioner', keywords: ['improv', 'wifi', 'provisioner', 'home assistant', 'serial wifi', 'improv serial', 'wifi provisioning', 'wifi setup', 'wifi credentials', 'esphome', 'provision', 'esp web tools', 'set wifi'] },
      { id: 'telemetry', name: 'Telemetry Gauges', icon: Gauge, accent: 'cyan', desc: 'Speedometer sensor dials', keywords: ['telemetry', 'gauges', 'speedometer', 'dials', 'sensors', 'dashboard', 'sensor dashboard', 'live gauges', 'temperature', 'humidity', 'sensor data'] },
      { id: 'alerts', name: 'Crash & Panic Alerts', icon: ShieldAlert, accent: 'rose', desc: 'Auto-detect kernel panics', keywords: ['alerts', 'crash', 'panic', 'watchdog', 'coredump', 'kernel panic', 'backtrace', 'crash alerts', 'guru meditation', 'core dump', 'stack trace', 'reset reason', 'exception decoder', 'esp32 crash'] },
      { id: 'automation', name: 'Test Runner & Scripts', icon: Bot, accent: 'purple', desc: 'Automated JS test routines', keywords: ['automation', 'scripts', 'test runner', 'javascript', 'testing', 'script runner', 'macro', 'send and expect', 'regression', 'automated testing', 'serial script', 'test script'] },
      { id: 'usb-inspector', name: 'USB Explorer & Autopsy', icon: Usb, accent: 'amber', desc: 'Interrogate a USB device: mystery-chip recon & baud hunting, plus lsusb -v descriptor explorer (configs, interfaces, endpoints)', keywords: ['autopsy', 'recon', 'mystery chip', 'vape', 'vid pid', 'baud hunter', 'reverse engineering', 'descriptors', 'usb-descriptors', 'lsusb', 'tree', 'endpoints', 'interfaces', 'configs', 'explorer', 'usb descriptors', 'lsusb -v', 'usbview', 'usb tree', 'descriptor', 'device descriptor', 'configuration descriptor', 'endpoint', 'interface', 'vendor id', 'product id', 'usb ids', 'unknown device', 'usb autopsy', 'device recon', 'identify usb device', 'what is this usb', 'webusb', 'usb info'] },
      { id: 'usb-rea', name: 'USB Protocol RE', icon: ScanSearch, accent: 'amber', desc: 'usb-rea: turn a labeled usbmon/USBPcap capture into a protocol report, Python driver scaffold and Wireshark dissector', keywords: ['usb-rea', 'reverse engineering', 'protocol', 'pcap', 'pcapng', 'usbmon', 'usbpcap', 'wireshark', 'dissector', 'driver', 'scaffold', 'vendor app', 'rgb', 'aio', 'liquidctl', 'openrgb', 'vid pid', 'lookup', 'usb reverse engineering', 'protocol reverse', 'reverse engineer usb', 'protocol re', 'lua dissector', 'python driver', 'vendor protocol', 'rgb controller', 'aio cooler', 'hid protocol', 'unknown protocol', 'labeled capture'] },
      { id: 'hid', name: 'HID Inspector', icon: Keyboard, accent: 'purple', desc: 'Decode live reports, report rate, record/playback, output & feature reports (WebHID)', keywords: ['hid', 'webhid', 'reports', 'gamepad', 'keyboard', 'mouse', 'input reports', 'hid report', 'report descriptor', 'hid descriptor', 'report rate', 'polling rate', 'joystick', 'output report', 'feature report', 'record playback', 'macro pad', 'controller test', 'mouse polling rate', 'hid usage', 'hid inspector'] },
      { id: 'mass-storage', name: 'Mass Storage Inspector', icon: HardDrive, accent: 'amber', desc: 'Read-only: partitions, FAT/exFAT browsing, deleted-file recovery, imaging with SHA-256', keywords: ['mass storage', 'usb drive', 'flash drive', 'fat32', 'exfat', 'forensics', 'carving', 'mbr', 'scsi', 'msc', 'bot', 'thumb drive', 'pen drive', 'usb stick', 'fat16', 'gpt', 'partition table', 'file recovery', 'undelete', 'deleted files', 'data recovery', 'disk image', 'imaging', 'file carving', 'sha-256', 'read only', 'bulk only', 'disk dump'] },
      { id: 'ptp', name: 'PTP / MTP Camera', icon: Camera, accent: 'purple', desc: 'Storage, thumbnails, bulk download, delete and remote capture over WebUSB', keywords: ['ptp', 'mtp', 'camera', 'dslr', 'photos', 'canon', 'nikon', 'sony', 'tether', 'mirrorless', 'tethering', 'remote capture', 'remote shutter', 'thumbnails', 'download photos', 'android file transfer', 'phone files', 'media transfer', 'picture transfer'] },
      { id: 'fido2', name: 'FIDO2 Security Key', icon: KeyRound, accent: 'emerald', desc: 'Read a security key: versions, AAGUID, options (WebHID, read-only)', keywords: ['fido2', 'webauthn', 'u2f', 'security key', 'yubikey', 'ctap2', 'aaguid', 'fido', 'ctap', 'passkey', 'authenticator', 'hardware key', '2fa', 'mfa', 'getinfo', 'clientpin', 'key info'] }
    ]
  },
  {
    id: 'setup',
    title: 'SETUP & REFERENCE',
    items: [
      { id: 'wiki-external', name: 'Knowledge Base Wiki', icon: BookOpen, href: './wiki/', accent: 'amber', desc: 'Standalone documentation & firmware manual', keywords: ['wiki', 'docs', 'documentation', 'manual', 'help', 'guides', 'knowledge base', 'how to', 'tutorial', 'faq', 'reference'] },
      { id: 'session-log', name: 'Session Log & Report', icon: ScrollText, accent: 'emerald', desc: 'Everything the hardware tools did this session: devices, actions, errors. Export Markdown / JSON', keywords: ['session log', 'audit', 'report', 'export', 'markdown', 'json', 'history', 'activity log', 'audit log', 'event log', 'device log', 'what did i do'] },
      { id: 'setup', name: 'Linux Setup & Drivers', icon: HelpCircle, accent: 'purple', desc: 'udev rules & USB-UART drivers', keywords: ['setup', 'drivers', 'udev', 'linux', 'zadig', 'winusb', 'ch340', 'cp2102', 'linux setup', 'udev rules', 'permission denied', 'dialout', 'driver install', 'libusb', 'ch341', 'cp210x', 'ftdi', 'pl2303', 'device not found', 'cannot open port', 'troubleshooting', 'windows driver', 'permissions', 'usb permission', 'plugdev'] },
      { id: 'esp-dump', name: 'Silicon Memory Dump', icon: Cpu, accent: 'amber', desc: 'Direct eFuse and flash reader', keywords: ['esp-dump', 'efuse', 'silicon', 'flash dump', 'rom', 'mac address', 'efuses', 'read flash', 'firmware dump', 'dump firmware', 'backup firmware', 'chip id', 'chip info', 'flash id', 'esp32 dump', 'read mac', 'secure boot', 'flash encryption', 'memory dump', 'nvs', 'partition table', 'spiffs', 'littlefs'] },
      { id: 'pinouts-modal', name: 'Pinouts Reference', icon: BookOpen, isModal: true, accent: 'cyan', desc: 'ESP32 & USB wiring diagrams', keywords: ['pinouts', 'wiring', 'diagrams', 'esp32', 'level shift', 'pinout', 'pin diagram', 'esp32 pinout', 'strapping pins', 'level shifter', '5v', '3.3v', 'uart wiring', 'gpio map'] },
      { id: 'intel-modal', name: 'Chip Intelligence', icon: Cpu, isModal: true, accent: 'cyan', desc: 'VID/PID device identification', keywords: ['chip', 'intel', 'vid', 'pid', 'lookup', 'usb id', 'chip intelligence', 'vid pid lookup', 'usb id lookup', 'usb ids', 'vendor lookup', 'device identification', 'identify chip', 'usb vendor', 'usb database'] }
    ]
  }
];

export default function Sidebar({
  isMobile = false,
  activeTool,
  openTools = [],          // window ids currently open on the desktop
  onSelectTool,
  isCollapsed,
  onToggleCollapse,
  onOpenPinouts,
  onOpenHardwareIntel
}) {
  const [filterQuery, setFilterQuery] = useState('');

  const handleItemClick = (item, ev) => {
    if (item.id === 'wiki-external' || item.href) {
      const targetUrl = item.id === 'wiki-external'
        ? (activeTool ? `./wiki/?tool=${activeTool}` : './wiki/?article=workspace')
        : item.href;
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    } else if (item.id === 'pinouts-modal') {
      onOpenPinouts?.();
    } else if (item.id === 'intel-modal') {
      onOpenHardwareIntel?.();
    } else {
      // Alt/Ctrl-click opens another instance in a new window instead of
      // focusing the one that's already open.
      onSelectTool(item.id, (ev && (ev.altKey || ev.ctrlKey || ev.metaKey)) ? { forceNew: true } : undefined);
    }
    // On phones the sidebar is an overlay drawer; close it after a pick so the
    // tool's window isn't hidden behind it.
    if (isMobile) onToggleCollapse?.(true);
  };

  const getAccentStyles = (item, isActive) => {
    if (!isActive) {
      return 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border-transparent';
    }

    switch (item.accent) {
      case 'amber':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-amber-glow font-bold';
      case 'emerald':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-emerald-glow font-bold';
      case 'purple':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/50 shadow-purple-glow font-bold';
      case 'rose':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-rose-glow font-bold';
      case 'cyan':
      default:
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-cyan-glow font-bold';
    }
  };

  // On phones the sidebar floats over the workspace as a slide-in drawer, so a
  // tool window gets the full screen width underneath. On larger screens it
  // stays an in-flow rail that collapses to an icon strip.
  const layoutCls = isMobile
    ? `absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl shadow-black/70 ${isCollapsed ? '-translate-x-full' : 'translate-x-0'}`
    : `relative shrink-0 ${isCollapsed ? 'w-14 sm:w-16' : 'w-60 lg:w-64'}`;

  return (
    <>
    {/* Dim/backdrop behind the open drawer on mobile — tap to close */}
    {isMobile && !isCollapsed && (
      <div
        onClick={() => onToggleCollapse?.(true)}
        className="absolute inset-0 z-[9998] bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
      />
    )}
    <aside
      className={`border-r border-cyber-border bg-[#030712] flex flex-col transition-all duration-200 ${isMobile ? 'z-[9999]' : 'z-30'} font-mono select-none ${layoutCls}`}
    >
      {/* Sidebar Header & Search */}
      <div className="p-2.5 border-b border-slate-900 flex items-center justify-between gap-2">
        {!isCollapsed ? (
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Filter tools..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-2 py-1 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500"
            />
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2 pointer-events-none" />
          </div>
        ) : (
          <div className="w-full flex justify-center py-1">
            <button
              onClick={() => onToggleCollapse(!isCollapsed)}
              title="Expand sidebar"
              className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-900 text-cyan-400 border border-slate-800"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <button
          onClick={() => onToggleCollapse(!isCollapsed)}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800 shrink-0"
        >
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Nav Tool List */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-3 scrollbar-thin scrollbar-thumb-slate-800">
        {SIDEBAR_SECTIONS.map((section) => {
          const visibleItems = filterQuery ? searchTools(section.items, filterQuery) : section.items;

          if (visibleItems.length === 0) return null;

          return (
            <div key={section.id} className="space-y-1">
              {!isCollapsed && (
                <div className="px-2 pt-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {section.title}
                </div>
              )}

              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = 
                    activeTool === item.id ||
                    (item.id === 'alfa-wifi' && ['alfa-wifi', 'wifi-scanner'].includes(activeTool)) ||
                    (item.id === 'packet-analyzer' && ['packet-analyzer', 'hex', 'packets', 'kismet'].includes(activeTool)) ||
                    (item.id === 'wardrive' && ['wardrive', 'ubx'].includes(activeTool)) ||
                    (item.id === 'programmers' && ['programmers', 'ch341a', 'cmsis-dap', 'jtag-programmer', 'avr-isp'].includes(activeTool));
                  const isOpen = !item.isModal && !item.href && openTools.includes(windowKeyFor(item.id));

                  return (
                    <button
                      key={item.id}
                      onClick={(e) => handleItemClick(item, e)}
                      title={
                        item.id === 'wiki-external'
                          ? `Knowledge Base Wiki: Open documentation${activeTool ? ` for ${activeTool}` : ''}`
                          : `${item.name}: ${item.desc}${isOpen ? ' (open — click to bring its window to the front; Alt-click to open another instance)' : ''}`
                      }
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs border transition-all text-left ${getAccentStyles(
                        item,
                        isActive
                      )} ${isCollapsed ? 'justify-center px-1' : ''}`}
                    >
                      <span className="relative shrink-0">
                        <Icon className={`w-4 h-4 ${isActive ? 'scale-110' : 'opacity-70'}`} />
                        {isOpen && <span data-open-dot className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-emerald-400'}`} />}
                      </span>
                      {!isCollapsed && (
                        <div className="truncate flex-1 flex items-center gap-1.5">
                          <div className="truncate">{item.name}</div>
                          {item.demoOnly && (
                            <span className="shrink-0 px-1 rounded text-[9px] font-bold tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/40">DEMO</span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sidebar Footer collapse toggle for mobile/desktop */}
      <div className="p-2 border-t border-slate-900 bg-slate-950/60 flex items-center justify-between text-[11px] text-slate-500">
        {!isCollapsed && (
          <span className="text-[10px] truncate">Skon's USB Tool v2.0</span>
        )}
        <button
          onClick={() => onToggleCollapse(!isCollapsed)}
          className="w-full sm:w-auto p-1 rounded hover:bg-slate-900 text-slate-400 hover:text-slate-200 flex items-center justify-center"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
    </>
  );
}
