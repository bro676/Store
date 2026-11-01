export function bestStoreOrderDecision(order = {}) {
  const status = String(order?.status || order?.order_status || '').toLowerCase();
  const orderId = String(order?.order_id || order?.id || order?.orderId || '');
  const responseData = order?.replay_api ?? order?.data ?? order?.result ?? null;
  const metadata = {
    id:orderId || null,
    status,
    status_code:order?.status_code ?? null,
    price:order?.price ?? null,
  };
  if (status === 'accept' || status === 'accepted' || status === 'completed' || status === 'success') {
    return {
      action:'completed',
      message:'أكد Best Store قبول الطلب وإرجاع بيانات التسليم.',
      metadata,
      result:{ provider:'BEST_STORE', orderId:orderId || null, status, data:responseData, price:order?.price ?? null },
    };
  }
  if (status === 'wait' || status === 'pending' || status === 'processing') {
    return {
      action:'retry',
      delaySeconds:45,
      message:'Best Store ما زال يعالج الطلب؛ سيُعاد فحص الحالة بنفس معرّف الطلب.',
      metadata,
    };
  }
  if (status === 'reject' || status === 'rejected' || status === 'failed' || status === 'error') {
    return {
      action:'manual_review',
      errorText:'BEST_STORE_ORDER_REJECTED',
      message:'رفض Best Store الطلب. أُوقف الشراء التلقائي ويحتاج الطلب إلى مراجعة الإدارة.',
      metadata,
    };
  }
  return {
    action:'manual_review',
    errorText:'BEST_STORE_UNKNOWN_ORDER_STATUS',
    message:'لم يتعرّف النظام على حالة الطلب التي أعادها Best Store؛ أُحيل إلى مراجعة الإدارة بدلاً من إعادة الشراء.',
    metadata,
  };
}

export function classifyBestStoreError(error, previousFailureCount = 0) {
  const status = Number(error?.status || 0);
  const failures = Math.max(0, Number(previousFailureCount) || 0) + 1;
  const transient = status === 408 || status === 425 || status === 429 || status >= 500 ||
    ['BEST_STORE_TIMEOUT','BEST_STORE_NETWORK_ERROR'].includes(String(error?.code || ''));
  if (transient && failures <= 8) {
    return {
      action:'retry',
      failureCount:failures,
      delaySeconds:Math.min(900, 15 * (2 ** Math.min(failures - 1, 6))),
      errorText:String(error?.code || 'BEST_STORE_TEMPORARY_ERROR').slice(0,120),
      message:'تعذر تأكيد حالة الطلب من Best Store مؤقتاً؛ ستتم إعادة المحاولة بنفس معرّف الطلب.',
    };
  }
  return {
    action:'manual_review',
    failureCount:failures,
    errorText:String(error?.code || 'BEST_STORE_FULFILLMENT_FAILED').slice(0,120),
    message:'تعذر تنفيذ الطلب بأمان لدى Best Store. أُحيل إلى مراجعة الإدارة.',
  };
}
