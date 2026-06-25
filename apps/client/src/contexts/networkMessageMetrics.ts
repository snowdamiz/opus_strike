import { config } from '../config/environment';
import { measureFrameWork } from '../movement/networkDiagnostics';

const CLIENT_DIAGNOSTICS_ENABLED = config.clientDiagnosticsEnabled;

export function measureNetworkMessage<T>(type: string, handler: (data: T) => void): (data: T) => void {
  // When diagnostics are disabled the wrapper would do nothing but forward to the handler,
  // so return the handler directly and avoid allocating a closure per registration and a
  // `network.${type}` template string on every received message.
  if (!CLIENT_DIAGNOSTICS_ENABLED) return handler;

  const label = `network.${type}`;
  return (data) => {
    measureFrameWork(label, () => handler(data));
  };
}
