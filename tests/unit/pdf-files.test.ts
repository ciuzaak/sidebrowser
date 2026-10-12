import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { PdfFiles } from '../../src/main/pdf-files';

describe('PDF file opening', () => {
  let dir: string;
  const deps = { pickFile: vi.fn<() => Promise<string | null>>(), openTab: vi.fn(), showError: vi.fn<() => Promise<void>>() };

  beforeEach(async () => {
    vi.resetAllMocks();
    deps.showError.mockResolvedValue();
    dir = await mkdtemp(join(tmpdir(), 'sidebrowser-pdf-unit-'));
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('opens a readable PDF with a correctly encoded file URL', async () => {
    const path = join(dir, '报告 #100%.PDF');
    await writeFile(path, '%PDF-1.4');
    deps.pickFile.mockResolvedValue(path);
    await new PdfFiles(deps).pickAndOpen();
    expect(deps.openTab).toHaveBeenCalledWith(pathToFileURL(path).href);
    expect(deps.showError).not.toHaveBeenCalled();
  });

  it('cancelling does not open a tab or display an error', async () => {
    deps.pickFile.mockResolvedValue(null);
    await new PdfFiles(deps).pickAndOpen();
    expect(deps.openTab).not.toHaveBeenCalled();
    expect(deps.showError).not.toHaveBeenCalled();
  });

  it('rejects missing files, directories, relative paths and other file types', async () => {
    const folder = join(dir, 'folder.pdf');
    const txt = join(dir, 'file.txt');
    await mkdir(folder);
    await writeFile(txt, 'text');
    const files = new PdfFiles(deps);
    for (const path of [join(dir, 'missing.pdf'), folder, txt, 'relative.pdf']) await files.openPath(path);
    expect(deps.openTab).not.toHaveBeenCalled();
    expect(deps.showError).toHaveBeenCalledTimes(4);
  });

  it('prevents duplicate pickers and allows reopening after cancellation', async () => {
    let cancel!: (path: string | null) => void;
    deps.pickFile.mockImplementationOnce(() => new Promise((resolve) => { cancel = resolve; }));
    const files = new PdfFiles(deps);
    const pending = files.pickAndOpen();
    await files.pickAndOpen();
    expect(deps.pickFile).toHaveBeenCalledOnce();
    cancel(null);
    await pending;
    deps.pickFile.mockResolvedValue(null);
    await files.pickAndOpen();
    expect(deps.pickFile).toHaveBeenCalledTimes(2);
  });

  it('reports picker errors and releases the picker guard', async () => {
    const files = new PdfFiles(deps);
    deps.pickFile.mockRejectedValueOnce(new Error('Dialog failed')).mockResolvedValue(null);
    await files.pickAndOpen();
    await files.pickAndOpen();
    expect(deps.showError).toHaveBeenCalledOnce();
    expect(deps.pickFile).toHaveBeenCalledTimes(2);
  });
});
