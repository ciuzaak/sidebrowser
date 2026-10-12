import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { extname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface PdfFilesDeps {
  pickFile: () => Promise<string | null>;
  openTab: (url: string) => void;
  showError: (message: string) => Promise<void>;
}

/** Shared by the file picker, shortcut and completed PDF downloads. */
export class PdfFiles {
  private picking = false;

  constructor(private readonly deps: PdfFilesDeps) {}

  async pickAndOpen(): Promise<void> {
    if (this.picking) return;
    this.picking = true;
    try {
      const path = await this.deps.pickFile();
      if (path !== null) await this.openPath(path);
    } catch {
      await this.deps.showError('The file picker could not be opened. Please try again.');
    } finally {
      this.picking = false;
    }
  }

  async openPath(path: string): Promise<void> {
    try {
      if (!isAbsolute(path) || extname(path).toLowerCase() !== '.pdf' || !(await stat(path)).isFile()) {
        throw new Error('Not a PDF file');
      }
      await access(path, constants.R_OK);
      this.deps.openTab(pathToFileURL(path).href);
    } catch {
      await this.deps.showError('This PDF could not be opened. Check that the file still exists and is readable.');
    }
  }
}
