const MAX_PENDING_CHECKS = 120;
const MAX_TRANSIENT_FAILURES = 12;
const MAX_RETRY_SECONDS = 300;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function seagmOrderMetadata(data) {
  return {
    id: data?.id == null ? null : String(data.id).slice(0, 80),
    mch_order_id: String(data?.mch_order_id || '').slice(0, 100),
    type_id: finiteNumber(data?.type_id ?? data?.product_id),
    status: String(data?.status || '').slice(0, 80),
    status_code: finiteNumber(data?.status_code),
    pay_status: String(data?.pay_status || '').slice(0, 80),
    pay_status_code: finiteNumber(data?.pay_status_code),
    send_status: String(data?.send_status || '').slice(0, 80),
    send_status_code: finiteNumber(data?.send_status_code),
    buy_amount: finiteNumber(data?.buy_amount),
    currency: String(data?.currency || '').slice(0, 12),
  };
}

function manualReview(metadata, message, errorText) {
  return { action: 'manual_review', metadata, message, errorText };
}

function parseSentAt(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  const date = Number.isFinite(number)
    ? new Date(number < 100000000000 ? number * 1000 : number)
    : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function nextSeagmPollDelay(attemptCount) {
  const count = Math.max(1, Math.trunc(Number(attemptCount) || 1));
  return Math.min(MAX_RETRY_SECONDS, 30 * Math.ceil(count / 2));
}

/**
 * Classifies the supplier's persisted order response. This function never creates an order;
 * it only decides whether an already-created order is complete, still processing, or unsafe.
 */
export function evaluateSeagmOrder({
  providerOrder,
  kind,
  merchantOrderId,
  typeId,
  quantity = 1,
  attemptCount = 1,
} = {}) {
  const metadata = seagmOrderMetadata(providerOrder);
  if (!providerOrder || typeof providerOrder !== 'object' || Array.isArray(providerOrder)) {
    return manualReview(metadata, 'رد المورد غير صالح؛ تم تحويل الطلب لمراجعة الإدارة.', 'SEAGM_INVALID_ORDER_RESPONSE');
  }
  if (!['card', 'recharge'].includes(kind) ||
      metadata.mch_order_id !== String(merchantOrderId || '') ||
      metadata.type_id !== Number(typeId) ||
      metadata.buy_amount !== Number(quantity)) {
    return manualReview(metadata, 'بيانات طلب المورد لا تطابق طلب المتجر؛ أوقفنا التسليم الآلي للحماية.', 'SEAGM_ORDER_DETAILS_MISMATCH');
  }

  const statusCode = metadata.status_code;
  const payStatusCode = metadata.pay_status_code;
  const sendStatusCode = metadata.send_status_code;

  if (statusCode === 10003 && payStatusCode === 2 && sendStatusCode === 3) {
    if (kind === 'card') {
      const cards = Array.isArray(providerOrder.cards)
        ? providerOrder.cards.map(card => ({
            cardNumber: String(card?.card_number || '').slice(0, 200),
            cardPin: String(card?.card_pin || '').slice(0, 200),
            expired: String(card?.expired || '').slice(0, 40),
          }))
        : [];
      if (cards.length < Number(quantity) || cards.some(card => !card.cardNumber || !card.cardPin)) {
        return manualReview(metadata, 'أكد المورد اكتمال الطلب لكن بيانات البطاقة لم تصل كاملة. تم إيقاف التسليم التلقائي لتجنب تسليم ناقص.', 'SEAGM_CARD_DATA_INCOMPLETE');
      }
      return {
        action: 'completed',
        metadata,
        result: { cards },
        message: 'تم تسليم البطاقة الرقمية بنجاح.',
      };
    }
    return {
      action: 'completed',
      metadata,
      result: {
        deliveredAmount: String(providerOrder.sent_amount ?? providerOrder.send_amount ?? ''),
        sentAt: parseSentAt(providerOrder.sent_time),
      },
      message: 'أكد SEAGM اكتمال عملية الشحن.',
    };
  }

  if (statusCode === 10001 || statusCode === 10002) {
    if (payStatusCode !== 2) {
      return manualReview(metadata, 'أنشأ المورد الطلب لكن حالة دفعه لدى SEAGM ليست مؤكدة؛ يلزم تدخل الإدارة.', 'SEAGM_SUPPLIER_PAYMENT_NOT_CONFIRMED');
    }
    if (Number(attemptCount) >= MAX_PENDING_CHECKS) {
      return manualReview(metadata, 'تجاوز طلب المورد مدة المتابعة الآلية. تم تحويله لمراجعة الإدارة دون إعادة الشراء.', 'SEAGM_PENDING_TIMEOUT');
    }
    return {
      action: 'retry',
      metadata,
      delaySeconds: nextSeagmPollDelay(attemptCount),
      message: statusCode === 10001
        ? 'تم إرسال طلبك إلى SEAGM وهو بانتظار التنفيذ.'
        : 'SEAGM ينفذ طلبك الآن.',
    };
  }

  const refunded = statusCode === 10004 || payStatusCode === 3;
  return manualReview(
    metadata,
    refunded
      ? 'أعاد المورد مبلغ الطلب إلى رصيد الحساب أو ألغى التنفيذ؛ تواصل الدعم لمراجعة طلبك.'
      : 'لم يتمكن النظام من تأكيد اكتمال طلب المورد؛ تم تحويله لمراجعة الإدارة.',
    refunded ? 'SEAGM_ORDER_REFUNDED' : 'SEAGM_UNEXPECTED_ORDER_STATUS',
  );
}

/**
 * Provider errors are retried only when the request may have succeeded remotely or
 * the provider explicitly asks us to slow down. A blocked IP (HTTP 418) is never polled again.
 */
export function classifySeagmFulfillmentError(error, previousFailureCount = 0) {
  const status = Number(error?.status || 0);
  const rawCode = error?.code;
  const code = Number(rawCode);
  const codeText = String(rawCode || '');
  if (status === 418 || codeText === 'SEAGM_IP_BLOCKED') {
    return {
      action: 'manual_review',
      failureCount: Number(previousFailureCount) || 0,
      message: 'حظر SEAGM عنوان الخادم (HTTP 418). أوقفنا الطلبات التلقائية حتى تُراجع حالة الاتصال مع المورد.',
      errorText: 'SEAGM_IP_BLOCKED',
    };
  }

  const retryable = status === 429 || status >= 500 ||
    code === 20135 ||
    ['SEAGM_REQUEST_TIMEOUT', 'SEAGM_INVALID_JSON_RESPONSE', 'SEAGM_INVALID_RESPONSE'].includes(codeText) ||
    (status === 0 && !Number.isFinite(code));

  const previous = Math.max(0, Math.trunc(Number(previousFailureCount) || 0));
  const failureCount = previous + 1;
  if (!retryable || failureCount > MAX_TRANSIENT_FAILURES) {
    return {
      action: 'manual_review',
      failureCount: previous,
      message: 'لم يتمكن النظام من تنفيذ أو التحقق من طلب المورد بعد المحاولات الآمنة. تم تحويله لمراجعة الإدارة.',
      errorText: String(error?.code || error?.message || 'SEAGM_FULFILLMENT_FAILED').slice(0, 500),
    };
  }

  const retryAfter = Math.max(0, Number(error?.retryAfter) || 0);
  const exponential = 10 * (2 ** Math.min(previous, 5));
  return {
    action: 'retry',
    failureCount,
    delaySeconds: Math.min(MAX_RETRY_SECONDS, Math.max(retryAfter, exponential)),
    message: 'تعذر تأكيد رد SEAGM مؤقتاً. سيعيد النظام الفحص بنفس رقم الطلب دون إنشاء طلب مكرر.',
    errorText: String(error?.code || error?.message || 'SEAGM_TEMPORARY_ERROR').slice(0, 500),
  };
}

export const SEAGM_FULFILLMENT_LIMITS = Object.freeze({
  maxPendingChecks: MAX_PENDING_CHECKS,
  maxTransientFailures: MAX_TRANSIENT_FAILURES,
  maxRetrySeconds: MAX_RETRY_SECONDS,
});
