from pathlib import Path

ROOT = Path("nexa-store-premium-web")
server_path = ROOT / "server/src/server.js"
html_path = ROOT / "index.html"
env_path = ROOT / "server/.env.example"
readme_path = ROOT / "server/README.md"

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

server = server_path.read_text()
server = replace_once(
    server,
    "  timezoneOffsetMinutes: Number(process.env.SHAM_TIMEZONE_OFFSET_MINUTES || 180),\n};",
    "  timezoneOffsetMinutes: Number(process.env.SHAM_TIMEZONE_OFFSET_MINUTES || 180),\n"
    "  sypPerUsd: Number(process.env.SYP_PER_USD || 0),\n"
    "  fxUpdatedAt: process.env.SYP_PER_USD_UPDATED_AT || '',\n"
    "  fxSource: process.env.SYP_PER_USD_SOURCE || '',\n};",
    "server fx config"
)
server = replace_once(
    server,
    "const providerConfigReady = Boolean(cfg.apiToken && Buffer.byteLength(cfg.apiToken) <= 256 && cfg.walletId && Number.isInteger(cfg.orderTtlMinutes) && cfg.orderTtlMinutes >= 5 && cfg.orderTtlMinutes <= 1440 && cfg.maxAgeMs > 0 && cfg.futureSkewMs >= 0 && Number.isInteger(cfg.timezoneOffsetMinutes) && Math.abs(cfg.timezoneOffsetMinutes) <= 840);\n"
    "const paymentsReady = cfg.paymentsEnabled && Boolean(cfg.databaseUrl) && providerConfigReady && cfg.currency === 'SYP';",
    "const providerConfigReady = Boolean(cfg.apiToken && Buffer.byteLength(cfg.apiToken) <= 256 && cfg.walletId && Number.isInteger(cfg.orderTtlMinutes) && cfg.orderTtlMinutes >= 5 && cfg.orderTtlMinutes <= 1440 && cfg.maxAgeMs > 0 && cfg.futureSkewMs >= 0 && Number.isInteger(cfg.timezoneOffsetMinutes) && Math.abs(cfg.timezoneOffsetMinutes) <= 840 && Number.isFinite(cfg.sypPerUsd) && cfg.sypPerUsd > 0 && Number.isFinite(new Date(cfg.fxUpdatedAt).getTime()) && cfg.fxSource);\n"
    "const paymentsReady = cfg.paymentsEnabled && Boolean(cfg.databaseUrl) && providerConfigReady;",
    "server readiness"
)
server = replace_once(
    server,
    "  return { label: `\u0024{product.name} — \u0024{option.name} — \u0024{pack[0]}`, amountMinor: BigInt(pack[1]) * 100n };\n}\nfunction parseProviderDate",
    "  return { label: `\u0024{product.name} — \u0024{option.name} — \u0024{pack[0]}`, amountMinor: BigInt(pack[1]) * 100n };\n}\n"
    "function pricePack(pack, currency) {\n"
    "  if (currency === 'SYP') return { ...pack, currency, amountMinor:pack.amountMinor };\n"
    "  if (currency !== 'USD') return null;\n"
    "  const rateScaled = BigInt(Math.round(cfg.sypPerUsd * 10_000));\n"
    "  if (rateScaled <= 0n) return null;\n"
    "  const amountMinor = (pack.amountMinor * 10_000n + rateScaled / 2n) / rateScaled;\n"
    "  if (amountMinor < 1n) return null;\n"
    "  return { ...pack, currency, amountMinor };\n"
    "}\n"
    "function parseProviderDate",
    "server price converter"
)
server = replace_once(server, "amount: asAmount(pack.amountMinor), currency:cfg.currency,", "amount: asAmount(pack.amountMinor), currency:pack.currency,", "invoice currency")
server = replace_once(server, "String(payload.currency).toUpperCase() !== cfg.currency || decimalMinor(payload.amount) !== pack.amountMinor ||", "String(payload.currency).toUpperCase() !== pack.currency || decimalMinor(payload.amount) !== pack.amountMinor ||", "invoice response currency")
server = replace_once(
    server,
    "  const pack = findPack(input.categoryId, input.productId, input.optionId, Number(input.packIndex));\n"
    "  if (!pack) return { error:'INVALID_PRODUCT', status:400, message:'الباقة غير متاحة أو سعرها غير محدد.' };",
    "  const pack = findPack(input.categoryId, input.productId, input.optionId, Number(input.packIndex));\n"
    "  if (!pack) return { error:'INVALID_PRODUCT', status:400, message:'الباقة غير متاحة أو سعرها غير محدد.' };\n"
    "  const currency = String(input.currency || 'SYP').trim().toUpperCase();\n"
    "  if (!['SYP','USD'].includes(currency)) return { error:'INVALID_CURRENCY', status:400, message:'اختر الليرة السورية أو الدولار الأمريكي.' };\n"
    "  const pricedPack = pricePack(pack, currency);\n"
    "  if (!pricedPack) return { error:'INVALID_PRICE', status:400, message:'تعذر حساب السعر بالعملة المختارة.' };",
    "order currency selection"
)
server = replace_once(server, "invoice = await createShamInvoice(id, pack, wallet);", "invoice = await createShamInvoice(id, pricedPack, wallet);", "priced invoice")
server = replace_once(
    server,
    "[id,input.categoryId,input.productId,input.optionId,Number(input.packIndex),pack.label,pack.amountMinor.toString(),cfg.currency,name,phone,gameAccount,notes,invoice.expiresAt,invoice.invoiceNumber,invoice.identifier,invoice.walletLabel,invoice.walletAddress]);",
    "[id,input.categoryId,input.productId,input.optionId,Number(input.packIndex),pricedPack.label,pricedPack.amountMinor.toString(),pricedPack.currency,name,phone,gameAccount,notes,invoice.expiresAt,invoice.invoiceNumber,invoice.identifier,invoice.walletLabel,invoice.walletAddress]);",
    "persist priced order"
)
server = replace_once(
    server,
    "orderId:id, product:pack.label, amountMinor:pack.amountMinor.toString(), currency:cfg.currency, expiresAt:invoice.expiresAt.toISOString(),",
    "orderId:id, product:pricedPack.label, amountMinor:pricedPack.amountMinor.toString(), currency:pricedPack.currency, expiresAt:invoice.expiresAt.toISOString(),",
    "return priced order"
)
server = replace_once(
    server,
    "return send(res,200,{enabled,provider:'Sham Cash',currency:cfg.currency,receiverLabel,receiverAddress,orderTtlMinutes:cfg.orderTtlMinutes,maxTransactionAgeMinutes:Math.round(cfg.maxAgeMs/60_000),message});",
    "return send(res,200,{enabled,provider:'Sham Cash',currency:'SYP',currencies:['SYP','USD'],sypPerUsd:cfg.sypPerUsd,fxUpdatedAt:cfg.fxUpdatedAt,fxSource:cfg.fxSource,receiverLabel,receiverAddress,orderTtlMinutes:cfg.orderTtlMinutes,maxTransactionAgeMinutes:Math.round(cfg.maxAgeMs/60_000),message});",
    "public currency config"
)
server_path.write_text(server)

html = html_path.read_text()
html = replace_once(
    html,
    "const $=id=>document.getElementById(id);const money=v=>v>0?new Intl.NumberFormat('en-US').format(v)+' ل.س':'يحدد لاحقاً';const esc=s=>",
    "const $=id=>document.getElementById(id);const money=v=>v>0?new Intl.NumberFormat('en-US').format(v)+' ل.س':'يحدد لاحقاً';"
    "const formatMinor=(minor,currency='SYP')=>{const value=Number(BigInt(minor||0))/100;return currency==='USD'?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value):new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(value)+' ل.س'};"
    "const esc=s=>",
    "minor currency formatter"
)
html = replace_once(
    html,
    "let paymentConfigEnabled=false;\nfunction renderInvoiceDetails",
    "let paymentConfigEnabled=false;let sypPerUsd=0;let fxUpdatedAt='';\n"
    "function renderCurrencyPreview(){const p=state.selectedPack,choice=$('orderCurrency')?.value||'SYP',preview=$('currencyPreview'),hint=$('currencyRateHint');if(!p||!preview)return;if(choice==='USD'){if(!(sypPerUsd>0)){preview.textContent='سعر الدولار غير متاح حالياً';hint.textContent='لن يتم إنشاء فاتورة بالدولار قبل ضبط سعر التحويل على الخادم.';return;}const usd=Math.round((p.price/sypPerUsd)*100)/100;preview.textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(usd);hint.textContent='سعر مرجعي: 1 USD = '+new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(sypPerUsd)+' ل.س · '+(fxUpdatedAt||'تاريخ التحديث غير محدد');}else{preview.textContent=money(p.price);hint.textContent='السعر الأساسي بالليرة السورية. يعتمد الخادم السعر النهائي عند إنشاء الفاتورة.';}}\n"
    "function renderInvoiceDetails",
    "currency preview"
)
html = replace_once(
    html,
    "<div class=\"field full\" id=\"accountField\">",
    "<div class=\"field full currency-field\"><label for=\"orderCurrency\">عملة الدفع *</label><select id=\"orderCurrency\" name=\"currency\" required><option value=\"SYP\">الليرة السورية (SYP)</option><option value=\"USD\">الدولار الأمريكي (USD)</option></select><strong id=\"currencyPreview\">—</strong><small id=\"currencyRateHint\">يُحسب السعر النهائي على الخادم عند إنشاء الفاتورة.</small></div><div class=\"field full\" id=\"accountField\">",
    "currency selector markup"
)
html = replace_once(
    html,
    "function openOrder(packIndex){const it=getItem(state.item),op=getOption(state.option),p=op.packs[packIndex];state.selectedPack={category:state.category,item:state.item,option:state.option,index:packIndex,name:`\u0024{it.name} — \u0024{op.name} — \u0024{p[0]}`,price:p[1],image:it.image};$('modalProduct').textContent=it.name+' — '+p[0];$('modalOption').textContent=op.name+' · خيار تجريبي';$('modalImage').src=it.image;$('modalPrice').textContent=money(p[1]);$('accountField').classList.toggle('hidden',!['games','apps'].includes(state.category));",
    "function openOrder(packIndex){const it=getItem(state.item),op=getOption(state.option),p=op.packs[packIndex];state.selectedPack={category:state.category,item:state.item,option:state.option,index:packIndex,name:`\u0024{it.name} — \u0024{op.name} — \u0024{p[0]}`,price:p[1],image:it.image};$('modalProduct').textContent=it.name+' — '+p[0];$('modalOption').textContent=op.name+' · خيار تجريبي';$('modalImage').src=it.image;$('modalPrice').textContent=money(p[1]);$('orderCurrency').value='SYP';renderCurrencyPreview();$('accountField').classList.toggle('hidden',!['games','apps'].includes(state.category));",
    "open order currency preview"
)
html = replace_once(
    html,
    "function renderOrders(){const d=storageRead(),rows=d.orders||[];$('orderBadge').textContent=rows.length;$('sideOrderBadge').textContent=rows.length;$('ordersTable').innerHTML=rows.length?rows.map(o=>`<tr><td class=\"ltr\">\u0024{esc(o.id)}</td><td>\u0024{esc(o.name)}</td><td>\u0024{esc(o.date)}</td><td>\u0024{money(o.price)}</td><td>",
    "function renderOrders(){const d=storageRead(),rows=d.orders||[];$('orderBadge').textContent=rows.length;$('sideOrderBadge').textContent=rows.length;$('ordersTable').innerHTML=rows.length?rows.map(o=>`<tr><td class=\"ltr\">\u0024{esc(o.id)}</td><td>\u0024{esc(o.name)}</td><td>\u0024{esc(o.date)}</td><td>\u0024{o.amountMinor?formatMinor(o.amountMinor,o.currency||'SYP'):money(o.price)}</td><td>",
    "order list currency"
)
html = replace_once(
    html,
    "body:JSON.stringify({categoryId:pack.category,productId:pack.item,optionId:pack.option,packIndex:pack.index,customerName:",
    "body:JSON.stringify({categoryId:pack.category,productId:pack.item,optionId:pack.option,packIndex:pack.index,currency:$('orderCurrency').value,customerName:",
    "send selected currency"
)
html = replace_once(
    html,
    "const order={id:data.orderId,name:data.product||pack.name,price:pack.price,date:",
    "const order={id:data.orderId,name:data.product||pack.name,price:pack.price,amountMinor:data.amountMinor,currency:data.currency,date:",
    "store order amount"
)
html = replace_once(
    html,
    "${money(Number(BigInt(data.amountMinor)/100n))} ${esc(data.currency)}",
    "${formatMinor(data.amountMinor,data.currency)}",
    "new order summary"
)
html = replace_once(
    html,
    "summary.innerHTML=`<span>المبلغ المطلوب · ${esc(d.status==='paid'?'مدفوع':d.status==='expired'?'منتهي':'بانتظار الدفع')} · ${esc(d.currency)}</span><strong>${money(Number(BigInt(d.amountMinor)/100n))} ${esc(d.currency)}</strong>",
    "summary.innerHTML=`<span>المبلغ المطلوب · ${esc(d.status==='paid'?'مدفوع':d.status==='expired'?'منتهي':'بانتظار الدفع')} · ${esc(d.currency)}</span><strong>${formatMinor(d.amountMinor,d.currency)}</strong>",
    "restore order summary"
)
html = replace_once(
    html,
    "paymentConfigEnabled=!!d.enabled;badge.textContent=",
    "paymentConfigEnabled=!!d.enabled;sypPerUsd=Number(d.sypPerUsd||0);fxUpdatedAt=d.fxUpdatedAt||'';renderCurrencyPreview();badge.textContent=",
    "load server FX"
)
html = replace_once(
    html,
    "$('orderForm').addEventListener('submit',doOrder);$('shamCashPaymentForm')",
    "$('orderForm').addEventListener('submit',doOrder);$('orderCurrency').addEventListener('change',renderCurrencyPreview);$('shamCashPaymentForm')",
    "currency selector event"
)
html = replace_once(
    html,
    ".wallet-api-layout{display:grid;",
    ".currency-field{padding:12px;border:1px solid #dcebe7;border-radius:13px;background:linear-gradient(120deg,#f5fbf9,#f8fbfd)}.currency-field select{width:100%;min-height:42px;padding:0 11px;border:1px solid #dbe7e4;border-radius:10px;background:#fff;color:#23394b;font-weight:800}.currency-field strong{display:block;margin-top:7px;color:#187f70;font-size:18px;direction:ltr;text-align:right}.currency-field small{display:block;color:#758797;font-size:8px;line-height:1.8;margin-top:4px}\n.wallet-api-layout{display:grid;",
    "currency selector styles"
)
html_path.write_text(html)

env = env_path.read_text()
if "SYP_PER_USD=" not in env:
    env += "\n# Reference conversion rate: legacy SYP units per USD; refresh before changing live prices.\nSYP_PER_USD=14287.5\nSYP_PER_USD_UPDATED_AT=2026-10-30T12:20:00+03:00\nSYP_PER_USD_SOURCE=https://sypnow.com/en/rates\n"
env_path.write_text(env)

readme = readme_path.read_text()
readme += "\n\n## Dual currency checkout\n\nThe checkout supports SYP and USD. Product catalog amounts remain the store's existing SYP price units; USD is calculated on the server from SYP_PER_USD, then the selected currency and exact amount are written into the Sham Cash invoice and PostgreSQL order. The browser never supplies a price. The reference FX rate must be reviewed and refreshed by the store operator; the source timestamp and source URL are returned by /api/payments/config. Sham Cash invoice/transaction verification must match the exact selected currency and amount.\n"
readme_path.write_text(readme)

print("Patched server, checkout UI, env example and server README.")
