import { useState, type ReactElement } from 'react';

export function App(): ReactElement {
  const [pingResult, setPingResult] = useState<string>('(not pinged yet)');

  const handlePing = async (): Promise<void> => {
    const response = await window.sidebrowser.ping('hello from renderer');
    setPingResult(`${response.reply} @ ${response.timestamp}`);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">sidebrowser</h1>
      <p className="text-sm opacity-70">M0 scaffold verification</p>
      <button
        type="button"
        onClick={handlePing}
        className="rounded bg-sky-600 px-4 py-2 text-sm hover:bg-sky-500 active:bg-sky-700"
      >
        Ping main
      </button>
      <code data-testid="ping-result" className="text-xs opacity-80">
        {pingResult}
      </code>
    </div>
  );
}
