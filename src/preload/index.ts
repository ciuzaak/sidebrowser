import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type IpcContract } from '@shared/ipc-contract';

const api = {
  ping: (message: string): Promise<IpcContract[typeof IpcChannels.appPing]['response']> =>
    ipcRenderer.invoke(IpcChannels.appPing, { message }),
};

contextBridge.exposeInMainWorld('sidebrowser', api);

export type SidebrowserApi = typeof api;
