/**
 * Alfa Wi-Fi Automation Rule Engine
 * Automated event evaluation, reactive webhooks, desktop notifications, and audio alerts.
 */

export const RULE_EVENT_TYPES = {
  DEVICE_CONNECTED: 'DEVICE_CONNECTED',
  DEVICE_DISCONNECTED: 'DEVICE_DISCONNECTED',
  ANOMALY_DETECTED: 'ANOMALY_DETECTED'
};

export const RULE_ACTION_TYPES = {
  WEBHOOK: 'WEBHOOK',
  NATIVE_NOTIFICATION: 'NATIVE_NOTIFICATION',
  AUDIO_BEEP: 'AUDIO_BEEP'
};

export const LOCAL_STORAGE_RULES_KEY = 'alfa_wifi_automation_rules';

/**
 * Standardize MAC addresses to uppercase colon-separated format (XX:XX:XX:XX:XX:XX)
 * @param {string} mac 
 * @returns {string}
 */
export function normalizeMac(mac) {
  if (!mac || typeof mac !== 'string') return '';
  return mac.trim().replace(/[-.]/g, ':').toUpperCase();
}

/**
 * Determine if a rule's target MAC matches the evaluated device.
 * Supports '*' or 'ANY' as wildcards.
 * @param {string} targetMac 
 * @param {object} device 
 * @returns {boolean}
 */
export function matchesTargetMac(targetMac, device) {
  if (!targetMac) return true;
  const normalizedTarget = normalizeMac(targetMac);
  if (normalizedTarget === '*' || normalizedTarget === 'ANY' || normalizedTarget === '') {
    return true;
  }
  if (!device || typeof device !== 'object') {
    return false;
  }

  const candidateMacs = [
    device.mac,
    device.bssid,
    device.clientMac,
    device.stationMac,
    device.sourceMac,
    device.targetMac,
    device.target,
    device.targetIdentifier,
    device.senderMac,
    device.ap
  ].filter(Boolean);

  for (const m of candidateMacs) {
    if (normalizeMac(m) === normalizedTarget) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates rules against a target device and event type.
 * Returns an array of matching rule objects.
 * 
 * @param {Array<object>} rules 
 * @param {object} device 
 * @param {string} eventType 
 * @returns {Array<object>}
 */
export function evaluateRules(rules, device, eventType) {
  if (!Array.isArray(rules) || !eventType) return [];

  return rules.filter(rule => {
    if (!rule || rule.enabled === false) return false;
    if (rule.eventType !== eventType) return false;
    return matchesTargetMac(rule.targetMac, device);
  });
}

/**
 * Trigger an audio oscillator beep using the Web Audio API.
 * @param {number} frequency 
 * @param {number} durationMs 
 * @param {string} type 
 */
export function playAudioBeep(frequency = 880, durationMs = 150, type = 'sine') {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, durationMs + 200);
  } catch (err) {
    console.warn('Web Audio playback error:', err);
  }
}

/**
 * Display a native desktop notification via Web Notification API.
 * @param {string} title 
 * @param {object} options 
 */
export async function showNativeNotification(title, options = {}) {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return null;

  try {
    if (Notification.permission === 'granted') {
      return new Notification(title, options);
    } else if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        return new Notification(title, options);
      }
    }
  } catch (err) {
    console.warn('Native notification error:', err);
  }
  return null;
}

/**
 * Dispatches an HTTP POST webhook request with JSON payload.
 * @param {string} url 
 * @param {object|string} payload 
 * @returns {Promise<Response>}
 */
export async function dispatchWebhook(url, payload) {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid webhook URL');
  }

  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body
  });
}

/**
 * Execute an individual matched rule action.
 * @param {object} rule 
 * @param {object} device 
 * @param {string} eventType 
 * @returns {Promise<any>}
 */
export async function executeRuleAction(rule, device, eventType) {
  if (!rule || !rule.actionType) return null;

  const targetIdentifier = device?.bssid || device?.clientMac || device?.mac || device?.target || 'Unknown Device';

  switch (rule.actionType) {
    case RULE_ACTION_TYPES.WEBHOOK: {
      const payload = {
        ruleId: rule.id,
        ruleName: rule.name || 'Automation Rule',
        eventType,
        targetMac: rule.targetMac || '*',
        timestamp: new Date().toISOString(),
        device
      };
      return dispatchWebhook(rule.actionPayload, payload);
    }

    case RULE_ACTION_TYPES.NATIVE_NOTIFICATION: {
      const title = rule.name ? `[Rule] ${rule.name}` : `Security Alert: ${eventType}`;
      const body = rule.actionPayload && rule.actionPayload.trim() 
        ? rule.actionPayload 
        : `Event ${eventType} triggered for target ${targetIdentifier}`;
      return showNativeNotification(title, {
        body,
        icon: '/favicon.ico',
        tag: `rule_${rule.id}_${Date.now()}`
      });
    }

    case RULE_ACTION_TYPES.AUDIO_BEEP: {
      const freq = parseInt(rule.actionPayload, 10);
      const validFreq = !isNaN(freq) && freq >= 100 && freq <= 5000 ? freq : 880;
      playAudioBeep(validFreq, 180);
      return true;
    }

    default:
      console.warn(`Unsupported rule action type: ${rule.actionType}`);
      return null;
  }
}

/**
 * Evaluates rules against an event and immediately executes all matching rule actions.
 * @param {Array<object>} rules 
 * @param {object} device 
 * @param {string} eventType 
 * @returns {Promise<Array<object>>}
 */
export async function evaluateAndExecuteRules(rules, device, eventType) {
  const matches = evaluateRules(rules, device, eventType);
  for (const match of matches) {
    try {
      await executeRuleAction(match, device, eventType);
    } catch (err) {
      console.warn(`Failed executing rule "${match.name || match.id}":`, err);
    }
  }
  return matches;
}

/**
 * Load persisted automation rules from localStorage.
 * @returns {Array<object>}
 */
export function loadRulesFromStorage() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_RULES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Failed loading rules from localStorage:', err);
    return [];
  }
}

/**
 * Persist automation rules to localStorage.
 * @param {Array<object>} rules 
 */
export function saveRulesToStorage(rules) {
  if (typeof localStorage === 'undefined') return;
  try {
    const safeRules = Array.isArray(rules) ? rules : [];
    localStorage.setItem(LOCAL_STORAGE_RULES_KEY, JSON.stringify(safeRules));
  } catch (err) {
    console.warn('Failed saving rules to localStorage:', err);
  }
}

/**
 * Create a new rule object with sensible defaults and unique identifier.
 * @param {object} params 
 * @returns {object}
 */
export function createRule({
  id = null,
  name = 'New Rule',
  eventType = RULE_EVENT_TYPES.DEVICE_CONNECTED,
  targetMac = '*',
  actionType = RULE_ACTION_TYPES.NATIVE_NOTIFICATION,
  actionPayload = '',
  enabled = true
} = {}) {
  return {
    id: id || `rule_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
    name: name.trim() || 'Untitled Rule',
    eventType,
    targetMac: targetMac.trim() ? normalizeMac(targetMac.trim()) : '*',
    actionType,
    actionPayload: actionPayload ? actionPayload.trim() : '',
    enabled: Boolean(enabled),
    createdAt: Date.now()
  };
}
