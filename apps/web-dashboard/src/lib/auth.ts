export type AccessTokenProvider = () => string | null | Promise<string | null>;

export interface ApiAuthHandlers {
  getAccessToken: AccessTokenProvider;
  onUnauthorized?: () => void;
  onForbidden?: () => void;
}

let handlers: ApiAuthHandlers | null = null;

/**
 * Configure the API client with an application-owned, memory-only token provider.
 * The dashboard does not persist or log tokens and does not implement a provider-specific OIDC flow.
 */
export function configureApiAuth(next: ApiAuthHandlers | null): void {
  handlers = next;
}

export async function getApiAccessToken(): Promise<string | null> {
  return handlers?.getAccessToken() ?? null;
}

export function notifyApiAuthFailure(status: number): void {
  if (status === 401) handlers?.onUnauthorized?.();
  if (status === 403) handlers?.onForbidden?.();
}
