import { measureFrameWork } from '../movement/networkDiagnostics';

export function measureNetworkMessage<T>(type: string, handler: (data: T) => void): (data: T) => void {
  return (data) => {
    measureFrameWork(`network.${type}`, () => handler(data));
  };
}
