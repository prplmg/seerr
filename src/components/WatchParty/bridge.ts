type Reply = { status: string; message?: string; version?: string };
export function partyBridge(
  action: string,
  payload: unknown = {}
): Promise<Reply> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
    };
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.source !== 'catalogue-koala-extension' ||
        event.data.id !== id
      )
        return;
      cleanup();
      resolve(event.data.result);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(Error('Extension did not respond'));
    }, 5000);
    window.addEventListener('message', receive);
    window.postMessage(
      { source: 'catalogue-koala', id, action, payload },
      location.origin
    );
  });
}
