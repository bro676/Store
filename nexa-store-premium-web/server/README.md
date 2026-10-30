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
- لم تُنفّذ خدمة تسليم المنتجات بعد الدفع. هذا التكامل يثبت حالة الدفع فقط؛ ربط مزود التسليم/إرسال الشحن يحتاج API منفصلاً.
- لم تُنفّذ معاملة مالية فعلية من بيئة الاختبار؛ تحقق من حسابك الحقيقي بعد ضبط الأسرار والصلاحيات.


## Dual currency checkout

The checkout supports SYP and USD. Product catalog amounts remain the store's existing SYP price units; USD is calculated on the server from SYP_PER_USD, then the selected currency and exact amount are written into the Sham Cash invoice and PostgreSQL order. The browser never supplies a price. The reference FX rate must be reviewed and refreshed by the store operator; the source timestamp and source URL are returned by /api/payments/config. Sham Cash invoice/transaction verification must match the exact selected currency and amount.
