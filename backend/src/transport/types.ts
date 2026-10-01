export type Fields = Record<string, unknown>

// Everything the backend wants to know about devices, independent of how it arrives.
// A transport translates its wire format (MQTT messages, SQS messages, ...) into these calls.
export interface DeviceEvents {
  telemetry(deviceId: string, msg: { ts: string; waterTempC: number; state: string; firmwareVersion: string }): Promise<void>
  status(deviceId: string, online: boolean, at: Date): Promise<void>
  reported(deviceId: string, msg: { version: number; state: Fields }): Promise<void>
  otaStatus(deviceId: string, msg: { jobId: string; status: string }): Promise<void>
}

// The one seam between the backend and the device network.
export interface Transport {
  // Begin delivering device events to `events`. Resolves once the transport is ready.
  start(events: DeviceEvents): Promise<void>
  // Tell a device what state we want. Must still reach a device that is offline right now.
  setDesired(deviceId: string, version: number, state: Fields): Promise<void>
  // Tell a device to run an OTA job.
  dispatchOta(deviceId: string, job: { jobId: string; version: string }): Promise<void>
}
