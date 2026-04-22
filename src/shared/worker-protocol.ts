import type {
  AlertsAckInput,
  AlertTriggeredEvent,
  CityMapImportPayload,
  EventChannel,
  EventPayloadMap,
  InvokeChannel,
  InvokePayloadMap,
  InvokeResultMap,
  PickSoundPayload,
} from '@/main/contracts/ipc';

export interface WorkerBootstrapData {
  dbPath: string;
  proxyUrl?: string | null;
  builtinSoundDir?: string | null;
}

export type CoreInvokeChannel = Exclude<
  InvokeChannel,
  'app.control' | 'app.getControlState' | 'settings.previewSound'
>;

export type WorkerInvokePayloadMap = Omit<
  InvokePayloadMap,
  'app.control' | 'app.getControlState'
>;

export type WorkerInvokeResultMap = Omit<
  InvokeResultMap,
  'app.control' | 'app.getControlState'
>;

export type WorkerInvokeChannel = CoreInvokeChannel;

export interface WorkerRequest<C extends WorkerInvokeChannel = WorkerInvokeChannel> {
  kind: 'request';
  id: string;
  channel: C;
  payload?: WorkerInvokePayloadMap[C];
}

export interface WorkerSuccessResponse<
  C extends WorkerInvokeChannel = WorkerInvokeChannel,
> {
  kind: 'response';
  id: string;
  ok: true;
  channel: C;
  payload: WorkerInvokeResultMap[C];
}

export interface WorkerErrorResponse<C extends WorkerInvokeChannel = WorkerInvokeChannel> {
  kind: 'response';
  id: string;
  ok: false;
  channel: C;
  error: string;
}

export type WorkerResponse<C extends WorkerInvokeChannel = WorkerInvokeChannel> =
  | WorkerSuccessResponse<C>
  | WorkerErrorResponse<C>;

export interface WorkerEvent<C extends EventChannel = EventChannel> {
  kind: 'event';
  channel: C;
  payload: EventPayloadMap[C];
}

export type WorkerMessage =
  | WorkerRequest
  | WorkerResponse
  | WorkerEvent;

export type {
  AlertsAckInput,
  AlertTriggeredEvent,
  CityMapImportPayload,
  EventChannel,
  EventPayloadMap,
  InvokeChannel,
  InvokePayloadMap,
  InvokeResultMap,
  PickSoundPayload,
};
