type VoiceDisconnectHandler = (reason?: string) => void;

let disconnectHandler: VoiceDisconnectHandler | null = null;

export function registerVoiceDisconnectHandler(handler: VoiceDisconnectHandler): () => void {
  disconnectHandler = handler;
  return () => {
    if (disconnectHandler === handler) {
      disconnectHandler = null;
    }
  };
}

export function disconnectVoice(reason?: string): void {
  disconnectHandler?.(reason);
}
