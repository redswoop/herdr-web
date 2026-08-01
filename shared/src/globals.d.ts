/** Minimal ambient types so shared stays out of the full DOM lib. */

interface MessageEvent {
  data: string;
  type?: string;
}

interface Event {
  type?: string;
}

declare function fetch(input: string, init?: RequestInit): Promise<Response>;

interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer | Blob | null;
}

interface Response {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  // any (not unknown) so consumers that cast via `.then(j => …)` keep working
  // without a full DOM lib in this package
  json(): Promise<any>;
  text(): Promise<string>;
}
