// Centralized IPC channel names and payload types.
// All main/renderer IPC must go through this module — never use string literals inline.

export const IpcChannels = {
  // Smoke-test channel used by M0 to verify the IPC bridge is wired up.
  appPing: 'app:ping',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

export interface IpcContract {
  [IpcChannels.appPing]: {
    request: { message: string };
    response: { reply: string; timestamp: number };
  };
}
