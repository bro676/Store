# Nexa Store — Sham Cash API v1

Backend Node.js + PostgreSQL لربط الدفع الرسمي من خلال API الخاص بـ sybclint. التكامل لا يعتمد على صور الإيصالات أو إدخال حالة الدفع من المتصفح.

## API contract المعتمد

Base URL كما ورد في التوثيق المرفق:

```text
https://apis-shamcash.com/api
```

المسارات التي يستخدمها هذا المشروع حرفياً:

| الغرض | المسار | الصلاحية |
|---|---|---|
| جلب المحافظ المرتبطة | `GET /v1/wallets` | `read:wallets` |
| قراءة عملية برقمها | `GET /v1/wallets/shamcash/{walletAddress}/transactions/{tranId}` | `read:transactions` |
| إنشاء فاتورة | `POST /v1/invoices` | `write:invoices` |
| التحقق من رقم العملية على الفاتورة | `POST /v1/invoices/{invoiceNumber}/verify` | `read:invoices` |
| إعادة قراءة حالة الفاتورة ومبلغها | `GET /v1/invoices/{invoiceNumber}` | `read:invoices` |

المصدر: ملف `sybclint-api-docs.md` المرفق، أقسام المحافظ وشام كاش والفواتير ورموز الأخطاء.

## كيف تتم عملية الدفع

1. يرسل المتصفح اختيار المنتج/الباقة وبيانات العميل فقط. لا يرسل السعر أو معرف المحفظة.
2. يعيد الخادم حساب السعر من `catalog.json`، ثم يطلب `GET /v1/wallets` ويتأكد أن `SHAM_WALLET_ID` يشير إلى محفظة `provider=shamcash` وحالتها `active`.
3. ينشئ الخادم فاتورة رسمية بـ `POST /v1/invoices`، ويُرسل `amount` كنص عشري، و`currency=SYP`، و`walletAddress` كمعرّف المحفظة، و`provider=shamcash`، و`expiresInMinutes`.
4. يُخزّن رقم الفاتورة ومعرّف المستلم والمبلغ ووقت الانتهاء في PostgreSQL، ثم يعرض للعميل عنوان الاستلام ورقم الفاتورة.
5. يكتب العميل رقم العملية كما ظهر في شام كاش.
6. الخادم يقرأ العملية مباشرة من سجل محفظة المتجر ويتأكد من رقمها، وأن `type=credit`، وأن عنوان `data.account.account_address` هو عنوان المحفظة المحدد للفاتورة، وأن العملة والمبلغ مطابقان تماماً.
7. يتحقق الخادم من `datetime`: لا تكون العملية أقدم من `PAYMENT_MAX_AGE_MINUTES`، ولا تقع في المستقبل، ويجب أن تقع ضمن فترة الطلب نفسه.
8. يرسل الخادم `POST /v1/invoices/{invoiceNumber}/verify` مع `transactionRef`، ثم يعيد قراءة الفاتورة بـ `GET /v1/invoices/{invoiceNumber}` ويتأكد من أن الحالة `paid` ورقم العملية والمستلم والمبلغ المدفوع (`paidAmount`) مطابقون تماماً.
9. تُسجّل العملية في قاعدة البيانات ويُغيّر الطلب إلى `paid` في معاملة SQL واحدة. قيود UNIQUE على `transaction_id` و`order_id` تمنع إعادة استخدام العملية أو دفع الطلب مرتين حتى مع الطلبات المتزامنة.

### ملاحظة المبلغ

يوضح التوثيق أن فحص فاتورة المزوّد يعيد `AMOUNT_MISMATCH` عند اختلاف المبلغ ويفيد بأن التسامح لدى المزوّد 1%. لذلك لا يعتمد Nexa على نتيجة `/verify` وحدها: يقرأ التحويل نفسه أولاً، ثم يفحص `paidAmount` في الفاتورة بعد التحقق، ويرفض محلياً أي فرق حتى لو كان ضمن هامش المزوّد. لا يتم اعتماد الطلب في Nexa إلا عند التطابق الدقيق.

### ملاحظة الوقت

مثال شام كاش في التوثيق يعيد `datetime` بصيغة `YYYY-MM-DD HH:mm:ss` من دون timezone. لذلك يفسر الخادم هذا الحقل باستخدام `SHAM_TIMEZONE_OFFSET_MINUTES`، وقيمته الافتراضية `180` (UTC+03:00). اضبطها على offset الفعلي الذي تستخدمه استجابة مزودك، ولا تغيّرها عشوائياً. حقول invoice `createdAt` و`expiresAt` و`paidAt` تقرأ كتواريخ ISO.

## صلاحيات مفتاح API

أنشئ مفتاحاً محدود الصلاحيات من لوحة التحكم، واختر فقط:

- `read:wallets`
- `read:transactions`
- `write:invoices`
- `read:invoices`

لا يحتاج Nexa إلى `account:manage` أو `write:transfers` أو `write:cash_in`. لا نطلب PIN محفظتك ولا ننفذ تحويلات خارجة.

## حدود API المطبقة

التوثيق يحدد قراءة تفاصيل سجل المعاملات بمعدل إضافي `1 request / 12 seconds` لكل مفتاح API، كما يحدد `/invoices/{id}/verify` بعشرة طلبات كل خمس دقائق لكل IP. يفرض الخادم حدوداً مشتركة عبر PostgreSQL حتى تبقى فعّالة عند تشغيل أكثر من نسخة:

- قراءة تفاصيل المعاملة: طلب واحد كل 12 ثانية لكل تكامل.
- التحقق من الفاتورة: 8 طلبات كل 5 دقائق، بهامش احتياطي تحت حد المزوّد.
- طلبات المستخدمين: 8 طلبات إنشاء بالدقيقة و8 محاولات تحقق خلال خمس دقائق لكل IP.

لا يستخدم النظام Webhook كمرجع نهائي. التوثيق يذكر أن إشعار الفاتورة يُرسل مرة واحدة فقط بلا إعادة محاولة؛ لذلك نقرأ الفاتورة بعد التحقق مباشرة من API باعتبارها حالة الحقيقة النهائية.

## الإعداد والتشغيل

المتطلبات: Node.js 20.11+ وPostgreSQL 14+.

```bash
cd server
npm install
cp .env.example .env
# املأ الأسرار محلياً أو في Secret/Environment settings في الاستضافة
npm start
```

`server/` لا يُقدّم كملفات static؛ الخادم يقدّم فقط `index.html` و`assets/`. لا تفتح HTML مباشرة لاختبار الدفع؛ يجب تشغيله من نفس نطاق الخادم عبر HTTPS.

### ضبط المحفظة

1. ضع `SHAM_API_TOKEN` في Secrets على الخادم فقط.
2. امنح المفتاح الصلاحيات الأربع الموضحة أعلاه.
3. اضبط `ADMIN_API_KEY` بقيمة عشوائية طويلة.
4. استدعِ `GET /api/admin/shamcash/wallets` مع ترويسة `X-Admin-Key` من بيئة موثوقة، وحدد `id` لمحفظة شام كاش النشطة.
5. ضع هذا المعرف في `SHAM_WALLET_ID`.
6. راجع جميع أسعار `server/catalog.json` واعتمد أسعار المتجر والعملة.
7. جهّز PostgreSQL واضبط `DATABASE_URL` و`DATABASE_SSL`.
8. فعّل `PAYMENTS_ENABLED=true` بعد اكتمال الإعداد، ثم أعد تشغيل الخدمة وافحص `/api/health` و`/api/payments/config`.

مثال جلب المحافظ من خادم Nexa:

```bash
curl https://YOUR-STORE.example/api/admin/shamcash/wallets \
  -H 'X-Admin-Key: YOUR_ADMIN_API_KEY'
```

## متغيرات البيئة المهمة

راجع `.env.example` لجميع المتغيرات. أهمها:

- `SHAM_API_BASE_URL=https://apis-shamcash.com/api`
- `SHAM_API_TOKEN` — سرّ خاص بالخادم.
- `SHAM_WALLET_ID` — UUID للمحفظة التي ظهرت في GET `/v1/wallets`.
- `SHAM_TIMEZONE_OFFSET_MINUTES=180` — offset لتفسير `datetime` بلا timezone.
- `PAYMENT_ORDER_TTL_MINUTES=15` — يجب أن يكون بين 5 و1440 وفق التوثيق.
- `PAYMENT_MAX_AGE_MINUTES=15` — حد حداثة العملية.
- `PAYMENT_CURRENCY=SYP` — متوافق مع كتالوج الأسعار الحالي.
- `PAYMENTS_ENABLED=false` — يبقى false حتى اعتماد المفاتيح والمحفظة والأسعار.

## Endpoints داخل Nexa

- `GET /api/health` — حالة الخدمة وقاعدة البيانات.
- `GET /api/payments/config` — حالة الربط بعد التحقق من المحفظة.
- `GET /api/admin/shamcash/wallets` — جلب بيانات المحافظ بشكل إداري محمي.
- `POST /api/orders` — إنشاء فاتورة شام كاش رسمية مرتبطة بطلب Nexa.
- `GET /api/orders/{orderId}` — استعادة ملخص الطلب والفاتورة.
- `POST /api/shamcash/verify` — التحقق من العملية والفاتورة وتسجيل الدفع.

## ملاحظات تشغيلية

- الأسعار في `catalog.json` ما زالت أسعاراً توضيحية من النسخة السابقة؛ لا تشغّل الدفع قبل اعتمادها تجارياً.
- مفتاح API لا يظهر في JavaScript ولا في الاستجابة العامة.
- `PAYMENTS_ENABLED` افتراضياً false، ولا نملك بيانات اعتماد حساب التاجر في هذا المشروع؛ يجب إدخالها على الاستضافة بنفسك.
- تم تنفيذ دورة تسليم SEAGM بعد تأكيد الدفع كما هو موضح في قسم **SEAGM fulfillment** أدناه. لا يتم شراء أي منتج من المورد قبل نجاح التحقق من فاتورة Sham Cash وتسجيل الدفع في معاملة PostgreSQL.
- لم تُنفّذ معاملة مالية فعلية من بيئة الاختبار؛ تحقق من حسابك الحقيقي بعد ضبط الأسرار والصلاحيات.


## Dual currency checkout

The checkout supports SYP and USD. Product catalogue prices are stored in new Syrian pounds. USD is calculated on the server using a fixed store rate of 145 new SYP per 1 USD; the browser never supplies or controls the final price. The selected currency and exact amount are written into the Sham Cash invoice and PostgreSQL order, and verification must match both.


## العملة الجديدة وFX

كتالوج الأسعار في هذا الإصدار صار بالليرة السورية الجديدة. تم تحويل كل القيم القديمة بنسبة 100 قديمة = 1 جديدة، مع الاحتفاظ بالقيمة الاقتصادية نفسها. السعر الأساسي يُرسل إلى Sham Cash بالعملة SYP الجديدة.

سعر الصرف الافتراضي يدوي على 145 ليرة سورية جديدة لكل دولار واحد. يمكن اختيار وضع SP Today API V2 من لوحة الإدارة بتحديد رابط Endpoint ومسار حقل السعر وطريقة المصادقة والوحدة (قديمة أو جديدة). عند استخدام الوضع الآلي يمنع الخادم تسعير الدولار إذا تجاوز آخر تحديث 30 دقيقة. يحسب الخادم قيمة USD ولا يعتمد على السعر الذي يرسله المتصفح.

## Regression tests

npm test يشغّل اختبارات HTTP وتحويل العملة على سعر ثابت 145 مع التحقق من التقريب.



## Admin control plane

The admin UI is served at `/admin.html`. Sign in with the Render `ADMIN_API_KEY`; the server issues an eight-hour HttpOnly/SameSite=Strict session cookie. Store catalogue/settings live in the PostgreSQL `nexa_store_state` row, created by migration `003_store_admin.sql`. Catalogue writes are shape-validated and image values are restricted to local asset paths, HTTPS URLs, or supported raster data URIs. API credentials are encrypted using a separate `STORE_SETTINGS_ENCRYPTION_KEY`; keep this key stable or re-encrypt stored secrets before rotating it.

Manual FX defaults to 145 new SYP per USD. Automatic FX only fetches HTTPS URLs on `api-v2.sp-today.com`, reads the configured JSON path, supports legacy/new SYP units, and refreshes every five minutes. USD checkout is blocked if automatic data is older than 30 minutes. The exact endpoint, JSON path, and auth header must be taken from the merchant's SP Today V2 documentation; they are deliberately not hard-coded here.

The admin order list can cancel an unpaid, unexpired invoice with the provider before changing its local state. Paid receipts are produced only from verified Sham Cash transactions and include the invoice and transaction references.



## External product catalogue API

The admin page has a catalogue connector with preview, manual sync, and an optional scheduled sync. Configure an HTTPS endpoint, JSON path (for example `catalog` or `data.catalog`), and optional `Authorization: Bearer` or `x-api-key` authentication. The JSON path may be empty when the response body itself is the categories array. Redirects are rejected and response bodies are capped at 4 MB. Private/local hosts, IP-literal URLs, non-HTTPS URLs, credentials in URLs, and non-standard ports are rejected.

The source must return the same category/product/options/packs structure used by `server/catalog.json`. Price values are numeric new Syrian pounds (SYP). Images must be HTTPS URLs, local `assets/` paths, or supported raster data URLs. The default sync mode is merge: categories and products with matching IDs are updated; existing local-only products and categories are retained. Replace mode explicitly makes the remote catalogue authoritative. Automatic sync interval is 5–1440 minutes and failed attempts are backoff-limited by the configured interval.

### Scoped product write API

Generate a scoped API key in the admin page. It is shown once and can be rotated or revoked. Keep it only on a trusted server. This key has access only to `POST /api/admin/catalog/products`, not to payment or store settings.

```http
POST /api/admin/catalog/products
Content-Type: application/json
X-Catalog-Key: <scoped-key>
```

Body:

```json
{
  "categoryId": "games",
  "product": {
    "id": "new-game",
    "name": "New Game",
    "desc": "Product description",
    "image": "https://cdn.vendor.net/new-game.webp",
    "options": [
      {
        "id": "global",
        "name": "Global",
        "desc": "Global account region",
        "flag": "🌐",
        "packs": [["100 Credits", 180], ["500 Credits", 750]]
      }
    ]
  }
}
```

A matching product ID is updated; a new product ID is inserted into the selected existing category. The response returns HTTP 201 for creation and HTTP 200 for update. Pack prices are in new SYP and are validated server-side.


## SEAGM fulfillment — automatic supplier delivery

SEAGM supplier orders are created **only after** Sham Cash verification succeeds. Creating a Nexa order or invoice never triggers a supplier purchase.

### Credentials and setup

1. Open Admin → SEAGM Supplier.
2. Start with the **Sandbox** environment.
3. Enter the SEAGM UID and Secret Key and save them. The secret is encrypted at rest and is never returned to the browser.
4. Use **Test account** to call the signed `GET /v1/me` endpoint.
5. Refresh the product catalogue, publish a low-cost test product, and confirm its local selling price in new SYP.
6. Confirm the SEAGM test account can buy both the card and/or direct-recharge type you intend to test.
7. After a successful Sandbox order and receipt, change to Production and repeat with a low-value product.

The merchant account needs an available SEAGM Credits balance for the supplier's `pay_amount_credits`. The store's selling price is separate from SEAGM's supplier charge/currency; review your margin and supplier balance before enabling live catalogue products.

### Purchase lifecycle

1. The buyer places an order for a published SEAGM product. The server validates quantity, product type, and all provider-required customer fields.
2. Nexa creates the Sham Cash invoice and stores the same Nexa order ID as the supplier `mch_order_id`. A unique database index prevents reuse of that merchant order ID.
3. The buyer pays. The existing Sham Cash checks must all pass: incoming credit, correct receiver wallet, exact amount and currency, transaction time, invoice status, and one-time transaction reference.
4. In the same PostgreSQL transaction that marks the Nexa order as paid, the server inserts one `nexa_fulfillment_jobs` row. An unpaid or unverified order cannot enter the supplier queue.
5. The worker first queries SEAGM by the same `mch_order_id`. It only creates a new card/recharge order if no supplier order exists. If the create request times out or SEAGM reports a duplicate merchant ID, the worker reconciles by that same ID before considering another create request.
6. Card orders are delivered only when the provider reports `status_code=10003`, `pay_status_code=2`, and `send_status_code=3`, with a complete card serial and PIN for every requested item. Card serials and PINs are encrypted before being stored; they are returned only with the matching Nexa order receipt.
7. Direct top-up orders are marked completed only after the same documented completed/paid/done status tuple. The receipt reports the supplier's delivery amount/time where provided.

### Status, retry, and support behavior

- `pending_payment`: waiting for the buyer's Sham Cash payment; no supplier job exists yet.
- `pending`: payment was verified and the supplier job is queued.
- `waiting`: SEAGM accepted the supplier order; Nexa is checking the existing order ID for completion.
- `completed`: SEAGM confirms paid + done, and the expected card data (if applicable) is present.
- `manual_review`: the supplier returned a non-retryable condition, a refund/unknown status, mismatched order details, incomplete card data, or a blocked IP response.

The worker polls pending supplier orders for up to 120 checks, with a capped interval of five minutes. Transport/server errors have a separate counter (maximum 12 attempts), so long-running supplier fulfilment does not consume the network retry allowance. HTTP 429 honours `Retry-After`; HTTP 418 (blocked IP) is stopped immediately and sent to manual review. Validation errors, insufficient Credits, and invalid player/account data are not blindly retried.

Admin → Orders shows the supplier state and has a manual retry action for eligible paid orders. Manual retry reuses the original merchant order ID and performs a lookup before any create call. A completed supplier order cannot be purchased again.

### What is and is not tested before credentials are added

The CI suite uses mocked SEAGM responses; it tests request signing, card/recharge payloads, order lookup by `mch_order_id`, paid/done status evaluation, encrypted delivery-result storage, retry/backoff, and the no-duplicate enqueue/reconciliation rules. It does not spend SEAGM Credits or create a real supplier order.

Once you add your own credentials, run the connection test in Sandbox and place one low-value end-to-end test order. Only then switch the environment to Production.
