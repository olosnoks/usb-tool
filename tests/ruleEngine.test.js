import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RULE_EVENT_TYPES,
  RULE_ACTION_TYPES,
  LOCAL_STORAGE_RULES_KEY,
  normalizeMac,
  matchesTargetMac,
  evaluateRules,
  createRule,
  loadRulesFromStorage,
  saveRulesToStorage,
  executeRuleAction,
  evaluateAndExecuteRules,
  playAudioBeep,
  showNativeNotification,
  dispatchWebhook
} from '../src/utils/ruleEngine.js';
import {
  extractMacsFromPacket,
  filterPacketsByMac,
  downloadTargetedPcap
} from '../src/utils/pcapExporter.js';

describe('Alfa Automation Rule Engine & Targeted Extraction', () => {
  let storageMap = {};

  beforeEach(() => {
    vi.clearAllMocks();
    storageMap = {};
    vi.stubGlobal('localStorage', {
      getItem: (key) => storageMap[key] || null,
      setItem: (key, val) => { storageMap[key] = String(val); },
      removeItem: (key) => { delete storageMap[key]; },
      clear: () => { storageMap = {}; }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('MAC Normalization & Matching', () => {
    it('normalizes MACs with lowercase, dashes or colons', () => {
      expect(normalizeMac('aa:bb:cc:dd:ee:ff')).toBe('AA:BB:CC:DD:EE:FF');
      expect(normalizeMac('00-c0-ca-98-76-54')).toBe('00:C0:CA:98:76:54');
      expect(normalizeMac('')).toBe('');
      expect(normalizeMac(null)).toBe('');
    });

    it('matches target MACs against multiple device candidate properties', () => {
      const ap = { bssid: '00:11:22:33:44:55', ssid: 'Corporate-WiFi' };
      const client = { clientMac: 'AA:BB:CC:DD:EE:FF', rssi: -65 };
      const generic = { mac: '66:77:88:99:AA:BB' };

      expect(matchesTargetMac('00:11:22:33:44:55', ap)).toBe(true);
      expect(matchesTargetMac('00-11-22-33-44-55', ap)).toBe(true);
      expect(matchesTargetMac('aa:bb:cc:dd:ee:ff', client)).toBe(true);
      expect(matchesTargetMac('66:77:88:99:aa:bb', generic)).toBe(true);

      // Mismatch
      expect(matchesTargetMac('FF:FF:FF:FF:FF:FF', ap)).toBe(false);

      // Wildcards
      expect(matchesTargetMac('*', ap)).toBe(true);
      expect(matchesTargetMac('ANY', client)).toBe(true);
      expect(matchesTargetMac('', generic)).toBe(true);
      expect(matchesTargetMac(null, ap)).toBe(true);
    });
  });

  describe('Rule Factory & Storage', () => {
    it('creates rules with proper structure and unique IDs', () => {
      const r1 = createRule({
        name: 'Alert on VIP Laptop',
        eventType: RULE_EVENT_TYPES.DEVICE_CONNECTED,
        targetMac: 'AA:BB:CC:DD:EE:FF',
        actionType: RULE_ACTION_TYPES.NATIVE_NOTIFICATION,
        actionPayload: 'VIP device joined the network'
      });

      expect(r1.id).toMatch(/^rule_\d+_/);
      expect(r1.name).toBe('Alert on VIP Laptop');
      expect(r1.eventType).toBe(RULE_EVENT_TYPES.DEVICE_CONNECTED);
      expect(r1.targetMac).toBe('AA:BB:CC:DD:EE:FF');
      expect(r1.actionType).toBe(RULE_ACTION_TYPES.NATIVE_NOTIFICATION);
      expect(r1.actionPayload).toBe('VIP device joined the network');
      expect(r1.enabled).toBe(true);
      expect(typeof r1.createdAt).toBe('number');
    });

    it('persists and loads rules to/from localStorage', () => {
      expect(loadRulesFromStorage()).toEqual([]);

      const rules = [
        createRule({ name: 'Rule 1', eventType: RULE_EVENT_TYPES.ANOMALY_DETECTED }),
        createRule({ name: 'Rule 2', eventType: RULE_EVENT_TYPES.DEVICE_DISCONNECTED })
      ];

      saveRulesToStorage(rules);
      const loaded = loadRulesFromStorage();
      expect(loaded.length).toBe(2);
      expect(loaded[0].name).toBe('Rule 1');
      expect(loaded[1].name).toBe('Rule 2');
    });
  });

  describe('Rule Evaluation Logic (evaluateRules)', () => {
    const rules = [
      createRule({
        id: 'r_connect_vip',
        name: 'VIP Connect',
        eventType: RULE_EVENT_TYPES.DEVICE_CONNECTED,
        targetMac: '11:22:33:44:55:66',
        actionType: RULE_ACTION_TYPES.AUDIO_BEEP
      }),
      createRule({
        id: 'r_connect_any',
        name: 'Any Connect',
        eventType: RULE_EVENT_TYPES.DEVICE_CONNECTED,
        targetMac: '*',
        actionType: RULE_ACTION_TYPES.NATIVE_NOTIFICATION
      }),
      createRule({
        id: 'r_disconnect_vip',
        name: 'VIP Disconnect',
        eventType: RULE_EVENT_TYPES.DEVICE_DISCONNECTED,
        targetMac: '11:22:33:44:55:66',
        actionType: RULE_ACTION_TYPES.WEBHOOK,
        actionPayload: 'https://webhook.site/test'
      }),
      createRule({
        id: 'r_anomaly_disabled',
        name: 'Disabled Anomaly',
        eventType: RULE_EVENT_TYPES.ANOMALY_DETECTED,
        targetMac: '*',
        actionType: RULE_ACTION_TYPES.AUDIO_BEEP,
        enabled: false
      })
    ];

    it('evaluates DEVICE_CONNECTED with specific and wildcard matches', () => {
      const vipDevice = { clientMac: '11:22:33:44:55:66', vendor: 'Apple' };
      const matched = evaluateRules(rules, vipDevice, RULE_EVENT_TYPES.DEVICE_CONNECTED);

      expect(matched.length).toBe(2);
      expect(matched.map(r => r.id)).toContain('r_connect_vip');
      expect(matched.map(r => r.id)).toContain('r_connect_any');
    });

    it('evaluates DEVICE_CONNECTED for unknown device matching only wildcard', () => {
      const otherDevice = { clientMac: '99:88:77:66:55:44' };
      const matched = evaluateRules(rules, otherDevice, RULE_EVENT_TYPES.DEVICE_CONNECTED);

      expect(matched.length).toBe(1);
      expect(matched[0].id).toBe('r_connect_any');
    });

    it('filters out disabled rules during evaluation', () => {
      const anomalyDevice = { bssid: '00:11:22:33:44:55', reason: 'Deauth flood' };
      const matched = evaluateRules(rules, anomalyDevice, RULE_EVENT_TYPES.ANOMALY_DETECTED);

      expect(matched.length).toBe(0);
    });

    it('handles edge cases gracefully', () => {
      expect(evaluateRules(null, {}, RULE_EVENT_TYPES.DEVICE_CONNECTED)).toEqual([]);
      expect(evaluateRules([], {}, null)).toEqual([]);
    });
  });

  describe('Action Handlers & Execution', () => {
    it('executes WEBHOOK action via fetch POST', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchSpy;

      const rule = createRule({
        name: 'Post to Slack',
        actionType: RULE_ACTION_TYPES.WEBHOOK,
        actionPayload: 'https://hooks.slack.com/services/test'
      });

      const device = { bssid: '11:22:33:44:55:66', ssid: 'Target-AP' };
      await executeRuleAction(rule, device, RULE_EVENT_TYPES.DEVICE_CONNECTED);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://hooks.slack.com/services/test');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.eventType).toBe(RULE_EVENT_TYPES.DEVICE_CONNECTED);
      expect(body.device.bssid).toBe('11:22:33:44:55:66');
    });

    it('executes AUDIO_BEEP action via Web Audio API', async () => {
      const mockSetValueAtTime = vi.fn();
      const mockExponentialRampToValueAtTime = vi.fn();
      const mockConnect = vi.fn();
      const mockStart = vi.fn();
      const mockStop = vi.fn();
      const mockClose = vi.fn().mockResolvedValue();

      const mockCtx = {
        currentTime: 0,
        createOscillator: vi.fn(() => ({
          type: 'sine',
          frequency: { setValueAtTime: mockSetValueAtTime },
          connect: mockConnect,
          start: mockStart,
          stop: mockStop
        })),
        createGain: vi.fn(() => ({
          gain: {
            setValueAtTime: mockSetValueAtTime,
            exponentialRampToValueAtTime: mockExponentialRampToValueAtTime
          },
          connect: mockConnect
        })),
        destination: {},
        close: mockClose
      };

      global.window = {
        AudioContext: vi.fn(() => mockCtx)
      };

      const rule = createRule({
        name: 'Chime on Connect',
        actionType: RULE_ACTION_TYPES.AUDIO_BEEP,
        actionPayload: '1200'
      });

      const res = await executeRuleAction(rule, { bssid: '11:22:33:44:55:66' }, RULE_EVENT_TYPES.DEVICE_CONNECTED);
      expect(res).toBe(true);
      expect(mockSetValueAtTime).toHaveBeenCalledWith(1200, 0);
      expect(mockStart).toHaveBeenCalled();
    });

    it('executes NATIVE_NOTIFICATION action via Notification API', async () => {
      const mockNotification = vi.fn();
      mockNotification.permission = 'granted';
      global.Notification = mockNotification;
      global.window = { Notification: mockNotification };

      const rule = createRule({
        name: 'Security Alert',
        actionType: RULE_ACTION_TYPES.NATIVE_NOTIFICATION,
        actionPayload: 'Rogue AP detected nearby!'
      });

      await executeRuleAction(rule, { bssid: '00:11:22:33:44:55' }, RULE_EVENT_TYPES.ANOMALY_DETECTED);
      expect(mockNotification).toHaveBeenCalledWith(
        '[Rule] Security Alert',
        expect.objectContaining({ body: 'Rogue AP detected nearby!' })
      );
    });

    it('evaluateAndExecuteRules processes all matching rules', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchSpy;

      const rules = [
        createRule({
          name: 'Send Webhook',
          eventType: RULE_EVENT_TYPES.ANOMALY_DETECTED,
          actionType: RULE_ACTION_TYPES.WEBHOOK,
          actionPayload: 'https://api.example.com/alert'
        })
      ];

      const executed = await evaluateAndExecuteRules(rules, { bssid: 'AA:BB:CC:DD:EE:FF' }, RULE_EVENT_TYPES.ANOMALY_DETECTED);
      expect(executed.length).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Targeted PCAP Extraction & 802.11 MAC Dissection', () => {
    // Construct a synthetic 802.11 Beacon frame with Radiotap Header
    // Radiotap header: 8 bytes (len = 0x0008)
    // 802.11 Frame:
    // Offset 8: Frame Control (0x80 0x00 = Beacon)
    // Offset 10: Duration (0x00 0x00)
    // Offset 12: Addr1 / DA (FF:FF:FF:FF:FF:FF)
    // Offset 18: Addr2 / SA (00:14:D1:E8:90:12)
    // Offset 24: Addr3 / BSSID (00:14:D1:E8:90:12)
    function buildMockRadiotapFrame(addr1Bytes, addr2Bytes, addr3Bytes) {
      const radiotap = [0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00];
      const fc = [0x80, 0x00, 0x00, 0x00];
      return new Uint8Array([
        ...radiotap,
        ...fc,
        ...addr1Bytes,
        ...addr2Bytes,
        ...addr3Bytes,
        0x00, 0x01, 0x02, 0x03 // payload
      ]);
    }

    const bssid1 = [0x00, 0x14, 0xD1, 0xE8, 0x90, 0x12]; // 00:14:D1:E8:90:12
    const bssid2 = [0xC8, 0x3A, 0x35, 0x11, 0x22, 0x33]; // C8:3A:35:11:22:33
    const broadcast = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
    const clientStation = [0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF];

    const pkt1 = buildMockRadiotapFrame(broadcast, bssid1, bssid1);
    const pkt2 = buildMockRadiotapFrame(broadcast, bssid2, bssid2);
    const pkt3 = buildMockRadiotapFrame(clientStation, bssid1, bssid1);

    it('extracts MAC addresses accurately from 802.11 frames with Radiotap header', () => {
      const macs = extractMacsFromPacket(pkt1);
      expect(macs).toContain('FF:FF:FF:FF:FF:FF');
      expect(macs).toContain('00:14:D1:E8:90:12');
    });

    it('filters packets matching target MAC in DA, SA, or BSSID', () => {
      const packets = [pkt1, pkt2, pkt3];

      // Filter for BSSID 1 (00:14:D1:E8:90:12) -> should match pkt1 and pkt3
      const matchesBssid1 = filterPacketsByMac(packets, '00:14:D1:E8:90:12');
      expect(matchesBssid1.length).toBe(2);
      expect(matchesBssid1).toContain(pkt1);
      expect(matchesBssid1).toContain(pkt3);

      // Filter for BSSID 2 (C8:3A:35:11:22:33) -> should match pkt2
      const matchesBssid2 = filterPacketsByMac(packets, 'c8-3a-35-11-22-33');
      expect(matchesBssid2.length).toBe(1);
      expect(matchesBssid2).toContain(pkt2);

      // Filter for Client Station (AA:BB:CC:DD:EE:FF) -> should match pkt3
      const matchesClient = filterPacketsByMac(packets, 'AA:BB:CC:DD:EE:FF');
      expect(matchesClient.length).toBe(1);
      expect(matchesClient).toContain(pkt3);

      // Filter for non-existent MAC -> 0 matches
      const noMatches = filterPacketsByMac(packets, '12:34:56:78:90:AB');
      expect(noMatches.length).toBe(0);

      // Wildcard returns all
      expect(filterPacketsByMac(packets, '*').length).toBe(3);
    });

    it('handles object wrapped packet records ({ data: Uint8Array })', () => {
      const wrapped = [
        { data: pkt1, timestamp: Date.now() },
        { data: pkt2, timestamp: Date.now() }
      ];

      const res = filterPacketsByMac(wrapped, '00:14:D1:E8:90:12');
      expect(res.length).toBe(1);
      expect(res[0].data).toBe(pkt1);
    });
  });
});
