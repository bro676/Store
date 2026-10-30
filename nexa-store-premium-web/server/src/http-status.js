export function isHttpErrorResult(result) {
  return Boolean(result && typeof result.error === 'string' &&
    Number.isInteger(result.status) && result.status >= 400 && result.status <= 599);
}

export function safeHttpStatus(status, fallback = 500) {
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : fallback;
}

export function httpStatusForResult(result, successStatus) {
  return isHttpErrorResult(result) ? result.status : safeHttpStatus(successStatus);
}
