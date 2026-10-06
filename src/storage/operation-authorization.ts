export interface OperationAuthorizationRequest {
  verify: (password: string) => Promise<void>;
  complete: () => void;
  cancel: () => void;
}

type Presenter = (request: OperationAuthorizationRequest | null) => void;
let presenter: Presenter | undefined;
let pending: OperationAuthorizationRequest | undefined;

/** The mounted page owns the dialog; storage clients retain their HTTP transport. */
export function registerOperationAuthorizationDialog(next: Presenter): () => void {
  pending?.cancel();
  presenter = next;
  return () => {
    if (presenter !== next) return;
    pending?.cancel();
    presenter = undefined;
  };
}

export function requestOperationAuthorization(verify: (password: string) => Promise<void>): Promise<void> {
  if (!presenter) return Promise.reject(new Error("操作密码框尚未准备好，请稍后重试"));
  if (pending) return Promise.reject(new Error("正在验证其他操作，请完成或取消后重试"));
  return new Promise((resolve, reject) => {
    const finish = (cancelled: boolean) => {
      // A cancelled request cannot resume a write when its HTTP validation returns late.
      if (pending !== request) return;
      pending = undefined;
      presenter?.(null);
      if (cancelled) reject(new Error("取消操作"));
      else resolve();
    };
    const request: OperationAuthorizationRequest = {
      verify,
      complete: () => finish(false),
      cancel: () => finish(true),
    };
    pending = request;
    presenter!(request);
  });
}
