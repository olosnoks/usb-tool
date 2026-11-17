/**
 * Hand-written schemas for the subset of meshtastic/protobufs this tool uses.
 * Field numbers were checked against the upstream .proto files (mesh.proto, channel.proto,
 * config.proto, module_config.proto, telemetry.proto, portnums.proto).
 *
 * Anything not listed here is kept as an unknown field by the codec, so decoding never
 * fails just because the firmware sends a message this file does not describe.
 * Security-sensitive sections (security/sessionkey/device_ui, channel PSK bytes) are
 * intentionally not decoded for display.
 */
import { defineMessage as m, f } from './protobuf.js';

// ---- Mesh packets -----------------------------------------------------------

export const Data = m('Data', [
  f(1, 'portnum', 'enum'),
  f(2, 'payload', 'bytes'),
  f(3, 'want_response', 'bool'),
  f(4, 'dest', 'fixed32'),
  f(5, 'source', 'fixed32'),
  f(6, 'request_id', 'fixed32'),
  f(7, 'reply_id', 'fixed32'),
  f(8, 'emoji', 'fixed32'),
  f(9, 'bitfield', 'uint32'),
]);

export const MeshPacket = m('MeshPacket', [
  f(1, 'from', 'fixed32'),
  f(2, 'to', 'fixed32'),
  f(3, 'channel', 'uint32'),
  f(4, 'decoded', 'message', { msg: Data }),
  f(5, 'encrypted', 'bytes'),
  f(6, 'id', 'fixed32'),
  f(7, 'rx_time', 'fixed32'),
  f(8, 'rx_snr', 'float'),
  f(9, 'hop_limit', 'uint32'),
  f(10, 'want_ack', 'bool'),
  f(11, 'priority', 'enum'),
  f(12, 'rx_rssi', 'int32'),
  f(14, 'via_mqtt', 'bool'),
  f(15, 'hop_start', 'uint32'),
  f(16, 'public_key', 'bytes'),
  f(17, 'pki_encrypted', 'bool'),
  f(18, 'next_hop', 'uint32'),
  f(19, 'relay_node', 'uint32'),
  f(21, 'transport_mechanism', 'enum'),
  f(22, 'xeddsa_signed', 'bool'),
  f(23, 'ack_proof_status', 'enum'),
  f(24, 'slot_parity', 'enum'),
]);

export const Routing = m('Routing', [
  f(3, 'error_reason', 'enum'),
  f(4, 'ack_proof', 'bytes'),
]);

// ---- Nodes ------------------------------------------------------------------

export const User = m('User', [
  f(1, 'id', 'string'),
  f(2, 'long_name', 'string'),
  f(3, 'short_name', 'string'),
  f(5, 'hw_model', 'enum'),
  f(6, 'is_licensed', 'bool'),
  f(7, 'role', 'enum'),
  f(8, 'public_key', 'bytes'),
  f(9, 'is_unmessagable', 'bool'),
]);

export const Position = m('Position', [
  f(1, 'latitude_i', 'sfixed32'),
  f(2, 'longitude_i', 'sfixed32'),
  f(3, 'altitude', 'int32'),
  f(4, 'time', 'fixed32'),
  f(5, 'location_source', 'enum'),
  f(6, 'altitude_source', 'enum'),
  f(7, 'timestamp', 'fixed32'),
  f(9, 'altitude_hae', 'sint32'),
  f(15, 'ground_speed', 'uint32'),
  f(16, 'ground_track', 'uint32'),
  f(17, 'fix_quality', 'uint32'),
  f(19, 'sats_in_view', 'uint32'),
  f(23, 'precision_bits', 'uint32'),
]);

export const DeviceMetrics = m('DeviceMetrics', [
  f(1, 'battery_level', 'uint32'),
  f(2, 'voltage', 'float'),
  f(3, 'channel_utilization', 'float'),
  f(4, 'air_util_tx', 'float'),
  f(5, 'uptime_seconds', 'uint32'),
]);

export const NodeInfo = m('NodeInfo', [
  f(1, 'num', 'uint32'),
  f(2, 'user', 'message', { msg: User }),
  f(3, 'position', 'message', { msg: Position }),
  f(4, 'snr', 'float'),
  f(5, 'last_heard', 'fixed32'),
  f(6, 'device_metrics', 'message', { msg: DeviceMetrics }),
  f(7, 'channel', 'uint32'),
  f(8, 'via_mqtt', 'bool'),
  f(9, 'hops_away', 'uint32'),
  f(10, 'is_favorite', 'bool'),
  f(11, 'is_ignored', 'bool'),
  f(13, 'is_muted', 'bool'),
  f(15, 'heard_on_current_lora', 'bool'),
]);

export const MyNodeInfo = m('MyNodeInfo', [
  f(1, 'my_node_num', 'uint32'),
  f(8, 'reboot_count', 'uint32'),
  f(11, 'min_app_version', 'uint32'),
  f(12, 'device_id', 'bytes'),
  f(13, 'pio_env', 'string'),
  f(14, 'firmware_edition', 'enum'),
  f(15, 'nodedb_count', 'uint32'),
]);

export const DeviceMetadata = m('DeviceMetadata', [
  f(1, 'firmware_version', 'string'),
  f(2, 'device_state_version', 'uint32'),
  f(3, 'canShutdown', 'bool'),
  f(4, 'hasWifi', 'bool'),
  f(5, 'hasBluetooth', 'bool'),
  f(6, 'hasEthernet', 'bool'),
  f(7, 'role', 'enum'),
  f(8, 'position_flags', 'uint32'),
  f(9, 'hw_model', 'enum'),
  f(10, 'hasRemoteHardware', 'bool'),
]);

// ---- Channels ---------------------------------------------------------------

export const ModuleSettings = m('ModuleSettings', [
  f(1, 'position_precision', 'uint32'),
  f(2, 'is_muted', 'bool'),
]);

/** `psk` is declared so the codec can skip it, but the UI never shows it (only its length). */
export const ChannelSettings = m('ChannelSettings', [
  f(1, 'channel_num', 'uint32'),
  f(2, 'psk', 'bytes'),
  f(3, 'name', 'string'),
  f(4, 'id', 'fixed32'),
  f(5, 'uplink_enabled', 'bool'),
  f(6, 'downlink_enabled', 'bool'),
  f(7, 'module_settings', 'message', { msg: ModuleSettings }),
]);

export const Channel = m('Channel', [
  f(1, 'index', 'int32'),
  f(2, 'settings', 'message', { msg: ChannelSettings }),
  f(3, 'role', 'enum'),
]);

// ---- Telemetry and logs -----------------------------------------------------

export const Telemetry = m('Telemetry', [
  f(1, 'time', 'fixed32'),
  f(2, 'device_metrics', 'message', { msg: DeviceMetrics }),
]);

export const LogRecord = m('LogRecord', [
  f(1, 'message', 'string'),
  f(2, 'time', 'fixed32'),
  f(3, 'source', 'string'),
  f(4, 'level', 'enum'),
]);

// ---- Config (read-only display) ---------------------------------------------

const DeviceConfig = m('DeviceConfig', [
  f(1, 'role', 'enum'),
  f(2, 'serial_enabled', 'bool'),
  f(4, 'button_gpio', 'uint32'),
  f(5, 'buzzer_gpio', 'uint32'),
  f(6, 'rebroadcast_mode', 'enum'),
  f(7, 'node_info_broadcast_secs', 'uint32'),
  f(8, 'double_tap_as_button_press', 'bool'),
  f(9, 'is_managed', 'bool'),
  f(10, 'disable_triple_click', 'bool'),
  f(11, 'tzdef', 'string'),
  f(12, 'led_heartbeat_disabled', 'bool'),
  f(13, 'buzzer_mode', 'enum'),
]);

const PositionConfig = m('PositionConfig', [
  f(1, 'position_broadcast_secs', 'uint32'),
  f(2, 'position_broadcast_smart_enabled', 'bool'),
  f(3, 'fixed_position', 'bool'),
  f(4, 'gps_enabled', 'bool'),
  f(5, 'gps_update_interval', 'uint32'),
  f(6, 'gps_attempt_time', 'uint32'),
  f(7, 'position_flags', 'uint32'),
  f(10, 'broadcast_smart_minimum_distance', 'uint32'),
  f(11, 'broadcast_smart_minimum_interval_secs', 'uint32'),
  f(13, 'gps_mode', 'enum'),
]);

const PowerConfig = m('PowerConfig', [
  f(1, 'is_power_saving', 'bool'),
  f(2, 'on_battery_shutdown_after_secs', 'uint32'),
  f(3, 'adc_multiplier_override', 'float'),
  f(4, 'wait_bluetooth_secs', 'uint32'),
  f(6, 'sds_secs', 'uint32'),
  f(7, 'ls_secs', 'uint32'),
  f(8, 'min_wake_secs', 'uint32'),
  f(9, 'device_battery_ina_address', 'uint32'),
]);

// wifi_psk is declared only so it is recognised and redacted in the config view.
const NetworkConfig = m('NetworkConfig', [
  f(1, 'wifi_enabled', 'bool'),
  f(3, 'wifi_ssid', 'string'),
  f(4, 'wifi_psk', 'string'),
  f(5, 'ntp_server', 'string'),
  f(6, 'eth_enabled', 'bool'),
  f(7, 'address_mode', 'enum'),
  f(9, 'rsyslog_server', 'string'),
  f(10, 'enabled_protocols', 'uint32'),
  f(11, 'ipv6_enabled', 'bool'),
]);

const DisplayConfig = m('DisplayConfig', [
  f(1, 'screen_on_secs', 'uint32'),
  f(3, 'auto_screen_carousel_secs', 'uint32'),
  f(4, 'compass_north_top', 'bool'),
  f(5, 'flip_screen', 'bool'),
  f(6, 'units', 'enum'),
  f(7, 'oled', 'enum'),
  f(8, 'displaymode', 'enum'),
  f(9, 'heading_bold', 'bool'),
  f(10, 'wake_on_tap_or_motion', 'bool'),
  f(11, 'compass_orientation', 'enum'),
  f(12, 'use_12h_clock', 'bool'),
  f(13, 'use_long_node_name', 'bool'),
  f(14, 'enable_message_bubbles', 'bool'),
]);

const LoRaConfig = m('LoRaConfig', [
  f(1, 'use_preset', 'bool'),
  f(2, 'modem_preset', 'enum'),
  f(3, 'bandwidth', 'uint32'),
  f(4, 'spread_factor', 'uint32'),
  f(5, 'coding_rate', 'uint32'),
  f(6, 'frequency_offset', 'float'),
  f(7, 'region', 'enum'),
  f(8, 'hop_limit', 'uint32'),
  f(9, 'tx_enabled', 'bool'),
  f(10, 'tx_power', 'int32'),
  f(11, 'channel_num', 'uint32'),
  f(12, 'override_duty_cycle', 'bool'),
  f(13, 'sx126x_rx_boosted_gain', 'bool'),
  f(14, 'override_frequency', 'float'),
  f(15, 'pa_fan_disabled', 'bool'),
  f(103, 'ignore_incoming', 'uint32', { rep: true }),
  f(104, 'ignore_mqtt', 'bool'),
  f(105, 'config_ok_to_mqtt', 'bool'),
]);

const BluetoothConfig = m('BluetoothConfig', [
  f(1, 'enabled', 'bool'),
  f(2, 'mode', 'enum'),
  f(3, 'fixed_pin', 'uint32'),
]);

/**
 * Config oneof variants. security (key material), sessionkey and device_ui are left
 * undecoded on purpose; they appear as unknown fields and are reported as such.
 */
export const Config = m('Config', [
  f(1, 'device', 'message', { msg: DeviceConfig }),
  f(2, 'position', 'message', { msg: PositionConfig }),
  f(3, 'power', 'message', { msg: PowerConfig }),
  f(4, 'network', 'message', { msg: NetworkConfig }),
  f(5, 'display', 'message', { msg: DisplayConfig }),
  f(6, 'lora', 'message', { msg: LoRaConfig }),
  f(7, 'bluetooth', 'message', { msg: BluetoothConfig }),
]);

const MqttConfig = m('MQTTConfig', [
  f(1, 'enabled', 'bool'),
  f(2, 'address', 'string'),
  f(3, 'username', 'string'),
  f(4, 'password', 'string'),
  f(5, 'encryption_enabled', 'bool'),
  f(6, 'json_enabled', 'bool'),
  f(7, 'tls_enabled', 'bool'),
  f(8, 'root', 'string'),
  f(9, 'proxy_to_client_enabled', 'bool'),
  f(10, 'map_reporting_enabled', 'bool'),
]);

const TelemetryConfig = m('TelemetryConfig', [
  f(1, 'device_update_interval', 'uint32'),
  f(2, 'environment_update_interval', 'uint32'),
  f(3, 'environment_measurement_enabled', 'bool'),
  f(4, 'environment_screen_enabled', 'bool'),
  f(5, 'environment_display_fahrenheit', 'bool'),
  f(6, 'air_quality_enabled', 'bool'),
  f(7, 'air_quality_interval', 'uint32'),
  f(8, 'power_measurement_enabled', 'bool'),
  f(9, 'power_update_interval', 'uint32'),
  f(10, 'power_screen_enabled', 'bool'),
  f(11, 'health_measurement_enabled', 'bool'),
  f(12, 'health_update_interval', 'uint32'),
  f(13, 'health_screen_enabled', 'bool'),
  f(14, 'device_telemetry_enabled', 'bool'),
  f(15, 'air_quality_screen_enabled', 'bool'),
]);

/** Only the module sections shown in the config view are named; the rest stay unknown. */
export const ModuleConfig = m('ModuleConfig', [
  f(1, 'mqtt', 'message', { msg: MqttConfig }),
  f(6, 'telemetry', 'message', { msg: TelemetryConfig }),
]);

// ---- Top-level envelopes ----------------------------------------------------

export const FromRadio = m('FromRadio', [
  f(1, 'id', 'uint32'),
  f(2, 'packet', 'message', { msg: MeshPacket }),
  f(3, 'my_info', 'message', { msg: MyNodeInfo }),
  f(4, 'node_info', 'message', { msg: NodeInfo }),
  f(5, 'config', 'message', { msg: Config }),
  f(6, 'log_record', 'message', { msg: LogRecord }),
  f(7, 'config_complete_id', 'uint32'),
  f(8, 'rebooted', 'bool'),
  f(9, 'moduleConfig', 'message', { msg: ModuleConfig }),
  f(10, 'channel', 'message', { msg: Channel }),
  f(13, 'metadata', 'message', { msg: DeviceMetadata }),
]);

export const Heartbeat = m('Heartbeat', []);

export const ToRadio = m('ToRadio', [
  f(1, 'packet', 'message', { msg: MeshPacket }),
  f(3, 'want_config_id', 'uint32'),
  f(4, 'disconnect', 'bool'),
  f(7, 'heartbeat', 'message', { msg: Heartbeat }),
]);
