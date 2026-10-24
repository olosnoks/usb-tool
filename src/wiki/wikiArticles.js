/**
 * Comprehensive Knowledge Base & Wiki Article Index
 * Aggregates all modular articles covering every tool, workbench, and suite in Skon's USB Tool
 */

import { CORE_ARTICLES } from './articles/coreArticles';
import { ANALYSIS_ARTICLES } from './articles/analysisArticles';
import { RF_ARTICLES } from './articles/rfArticles';
import { PAYLOAD_ARTICLES } from './articles/payloadArticles';
import { HARDWARE_ARTICLES } from './articles/hardwareArticles';
import { UTILITY_ARTICLES } from './articles/utilityArticles';
import { REFERENCE_ARTICLES } from './articles/referenceArticles';

export const WIKI_CATEGORIES = [
  { id: 'all', name: 'All Guides', icon: 'BookOpen' },
  { id: 'core', name: 'Core Operations', icon: 'Terminal', desc: 'Terminal, Flasher & Hardware' },
  { id: 'analysis', name: 'Analysis & Protocols', icon: 'Activity', desc: 'Packet Lab, Logic Analyzer, CAN, I2C/SPI, Modbus' },
  { id: 'rf', name: 'RF, Wireless & Badges', icon: 'Radio', desc: 'Flipper, Proxmark3, Mayhem, Wardrive, Marauder' },
  { id: 'pentesting', name: 'Pentesting & Payloads', icon: 'Keyboard', desc: 'RocketGod, Bruce & BadUSB Studio' },
  { id: 'programmers', name: 'Hardware & Power', icon: 'Cpu', desc: 'CH341A, CMSIS-DAP, JTAG, AVR, USB-PD' },
  { id: 'utilities', name: 'Device Utilities', icon: 'Wrench', desc: 'MicroPython, Improv, Telemetry, Autopsy' },
  { id: 'reference', name: 'Setup & Diagnostics', icon: 'AlertTriangle', desc: 'Drivers, Troubleshooting & Pinouts' }
];

export const WIKI_ARTICLES = [
  ...CORE_ARTICLES,
  ...ANALYSIS_ARTICLES,
  ...RF_ARTICLES,
  ...PAYLOAD_ARTICLES,
  ...HARDWARE_ARTICLES,
  ...UTILITY_ARTICLES,
  ...REFERENCE_ARTICLES
];
