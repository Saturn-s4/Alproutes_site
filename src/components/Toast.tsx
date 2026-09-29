import { useCallback, useEffect, useState } from 'react';

/** A single transient status message. Returns the element to render and a function to show text. */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 3200);
    return () => clearTimeout(id);
  }, [msg]);
  const node = msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
  return [node, useCallback((m: string) => setMsg(m), [])] as const;
}
