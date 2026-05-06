import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { bindHistoryRecorderEvents } from '../../src/main/view-manager';

class FakeRecorder {
  recordNavigation = vi.fn();
  patchTitle = vi.fn();
  patchFavicon = vi.fn();
  revokeFailed = vi.fn();
  forgetTab = vi.fn();
}

const makeWc = () => {
  const wc = new EventEmitter() as EventEmitter & {
    off: EventEmitter['removeListener'];
  };
  wc.off = wc.removeListener.bind(wc);
  return wc;
};

describe('bindHistoryRecorderEvents', () => {
  let wc: ReturnType<typeof makeWc>;
  let recorder: FakeRecorder;
  let detach: () => void;
  let currentUrl: string;

  beforeEach(() => {
    wc = makeWc();
    recorder = new FakeRecorder();
    currentUrl = 'about:blank';
    detach = bindHistoryRecorderEvents('tab1', wc as never, recorder as never, () => currentUrl);
  });

  it('did-navigate calls recordNavigation with tabId + url', () => {
    wc.emit('did-navigate', null, 'https://a.com');
    expect(recorder.recordNavigation).toHaveBeenCalledWith('tab1', 'https://a.com');
  });

  it('did-navigate-in-page is NOT recorded (SPA hash navigations skipped)', () => {
    wc.emit('did-navigate-in-page', null, 'https://a.com#section');
    expect(recorder.recordNavigation).not.toHaveBeenCalled();
  });

  it('page-title-updated patches via current URL from getter', () => {
    currentUrl = 'https://a.com';
    wc.emit('page-title-updated', null, 'Hello');
    expect(recorder.patchTitle).toHaveBeenCalledWith('https://a.com', 'Hello');
  });

  it('page-favicon-updated patches the first favicon', () => {
    currentUrl = 'https://a.com';
    wc.emit('page-favicon-updated', null, ['http://f.ico', 'http://f2.ico']);
    expect(recorder.patchFavicon).toHaveBeenCalledWith('https://a.com', 'http://f.ico');
  });

  it('page-favicon-updated patches null when array is empty', () => {
    currentUrl = 'https://a.com';
    wc.emit('page-favicon-updated', null, []);
    expect(recorder.patchFavicon).toHaveBeenCalledWith('https://a.com', null);
  });

  it('did-fail-load top-frame non-aborted → revokeFailed', () => {
    wc.emit('did-fail-load', null, -105, 'NAME_NOT_RESOLVED', 'https://a.com', true);
    expect(recorder.revokeFailed).toHaveBeenCalledWith('tab1');
  });

  it('did-fail-load with isMainFrame=false is ignored (subframe)', () => {
    wc.emit('did-fail-load', null, -105, 'NAME_NOT_RESOLVED', 'https://a.com', false);
    expect(recorder.revokeFailed).not.toHaveBeenCalled();
  });

  it('did-fail-load with errorCode -3 (ABORTED) is ignored', () => {
    wc.emit('did-fail-load', null, -3, 'ABORTED', 'https://a.com', true);
    expect(recorder.revokeFailed).not.toHaveBeenCalled();
  });

  it('detach() removes all four listeners', () => {
    detach();
    wc.emit('did-navigate', null, 'https://a.com');
    wc.emit('page-title-updated', null, 'Hi');
    wc.emit('page-favicon-updated', null, ['x']);
    wc.emit('did-fail-load', null, -105, 'X', 'https://a.com', true);
    expect(recorder.recordNavigation).not.toHaveBeenCalled();
    expect(recorder.patchTitle).not.toHaveBeenCalled();
    expect(recorder.patchFavicon).not.toHaveBeenCalled();
    expect(recorder.revokeFailed).not.toHaveBeenCalled();
  });

  it('null recorder is a no-op (no throws when bound with null)', () => {
    detach();
    const noopDetach = bindHistoryRecorderEvents('tab2', wc as never, null, () => 'https://a.com');
    expect(() => {
      wc.emit('did-navigate', null, 'https://a.com');
      wc.emit('did-fail-load', null, -105, 'X', 'https://a.com', true);
    }).not.toThrow();
    noopDetach();
  });
});
