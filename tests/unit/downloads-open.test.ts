import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import type { Session } from 'electron';
import { DownloadsManager } from '../../src/main/downloads';

function setup(filename: string) {
  const session = new EventEmitter();
  const item = Object.assign(new EventEmitter(), {
    getFilename: () => filename,
    getTotalBytes: () => 10,
    getReceivedBytes: () => 10,
    getURL: () => 'https://a.com/file',
    setSavePath: vi.fn(),
  });
  const deps = {
    getDirectory: () => process.cwd(), onChanged: vi.fn(),
    openPath: vi.fn().mockResolvedValue(''), openPdf: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn(),
  };
  const downloads = new DownloadsManager(deps);
  downloads.install(session as unknown as Session);
  session.emit('will-download', { preventDefault: vi.fn() }, item, { id: 1 });
  return { downloads, item, deps, id: downloads.list()[0].id };
}

describe('download opening', () => {
  it('opens completed PDFs inside the app, including uppercase extensions', () => {
    const { downloads, item, deps, id } = setup('report.PDF');
    item.emit('done', {}, 'completed');
    downloads.open(id);
    expect(deps.openPdf).toHaveBeenCalledWith(join(process.cwd(), 'report.PDF'));
    expect(deps.openPath).not.toHaveBeenCalled();
  });

  it('keeps ordinary files in the OS default application', () => {
    const { downloads, item, deps, id } = setup('report.txt');
    item.emit('done', {}, 'completed');
    downloads.open(id);
    expect(deps.openPath).toHaveBeenCalledOnce();
    expect(deps.openPdf).not.toHaveBeenCalled();
  });

  it('never opens unfinished, cancelled, blocked or executable downloads', () => {
    for (const filename of ['report.pdf', 'setup.exe', 'evil.scf']) {
      const { downloads, item, deps, id } = setup(filename);
      downloads.open(id);
      item.emit('done', {}, filename === 'report.pdf' ? 'cancelled' : 'completed');
      downloads.open(id);
      downloads.open('unknown');
      expect(deps.openPath).not.toHaveBeenCalled();
      expect(deps.openPdf).not.toHaveBeenCalled();
    }
  });
});
