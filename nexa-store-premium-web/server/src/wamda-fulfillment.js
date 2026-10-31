export function wamdaOrderDecision(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    return {action:'manual_review',status:'manual_review',errorCode:'WAMDA_INVALID_ORDER_RESPONSE',message:'رد ومضة غير صالح؛ تم تحويل الطلب لمراجعة الإدارة.'};
  }
  const status=String(order.status||'').toLowerCase();
  const metadata={
    id:String(order.orderId||order.orderCode||order.orderUuid||'').slice(0,120),
    orderCode:String(order.orderCode||'').slice(0,120),
    orderUuid:String(order.orderUuid||'').slice(0,80),
    status:status.slice(0,40),
  };
  if(status==='completed'){
    return {
      action:'completed',status:'completed',metadata,
      result:{orderCode:metadata.orderCode,orderUuid:metadata.orderUuid,deliveredData:String(order.deliveredData||'').slice(0,4000),price:order.price},
      message:'أكدت ومضة اكتمال تنفيذ الطلب.',
    };
  }
  if(status==='pending'||status==='processing'){
    return {action:'retry',status:'waiting',metadata,delaySeconds:45,message:status==='pending'?'تم استلام الطلب لدى ومضة وهو بانتظار التنفيذ.':'تعمل ومضة على تنفيذ الطلب حالياً.'};
  }
  if(status==='rejected'||status==='canceled'||status==='cancelled'){
    return {action:'manual_review',status:'manual_review',metadata,errorCode:'WAMDA_ORDER_'+status.toUpperCase(),message:String(order.deliveredData||'رفض المورد الطلب؛ تم تحويله لمراجعة الإدارة.').slice(0,500)};
  }
  return {action:'manual_review',status:'manual_review',metadata,errorCode:'WAMDA_UNKNOWN_ORDER_STATUS',message:'حالة الطلب لدى ومضة غير معروفة؛ تم تحويله لمراجعة الإدارة.'};
}
export function classifyWamdaError(error, previousFailureCount = 0) {
  const status=Number(error?.status||0);
  const code=String(error?.code||'');
  const previous=Math.max(0,Math.trunc(Number(previousFailureCount)||0));
  const retryable=status===429||status>=500||['WAMDA_REQUEST_TIMEOUT','WAMDA_NETWORK_ERROR','WAMDA_INVALID_JSON_RESPONSE'].includes(code);
  if(!retryable||previous>=8){
    return {action:'manual_review',failureCount:previous,errorCode:code||'WAMDA_API_ERROR',message:String(error?.message||'تعذر تنفيذ طلب ومضة.').slice(0,500)};
  }
  return {action:'retry',failureCount:previous+1,delaySeconds:Math.min(300,30*(2**Math.min(previous,3))),message:'تعذر الاتصال بومضة مؤقتاً؛ سيعيد النظام المحاولة بالمعرف نفسه لمنع تكرار الخصم.'};
}
