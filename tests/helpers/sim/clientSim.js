// Test-only helpers that put a hardware *client* into its (still in-driver)
// simulation mode by setting the fields the removed connectSimulation() entries
// used to set. The UI no longer exposes these modes; only tests reach them.
// Kept here (not in src) so the simulation entry points live with the tests.
export function simulateCmsis(client) {
  client.connected = true;
  client.simulated = true;
  client.targetState = 'running';
  client.initVirtualState();
  return client;
}

export function simulateBusExplorer(client) {
  client.isConnected = true;
  client.isSimulated = true;
  client.detectedDevices = [0x3C, 0x40, 0x48, 0x50, 0x68, 0x76];
  client._simSensors = null;
  client.initSimulatedRegisters(0x68);
  return client;
}
