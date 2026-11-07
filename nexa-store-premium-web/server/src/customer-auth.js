const ARABIC_DIGITS='٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS='۰۱۲۳۴۵۶۷۸۹';
const ASCII_DIGITS='0123456789';
export function normalizeCustomerPhone(value){
 const source=String(value??'').trim().replace(/[٠-٩۰-۹]/g,digit=>{const a=ARABIC_DIGITS.indexOf(digit);if(a>=0)return ASCII_DIGITS[a];const p=PERSIAN_DIGITS.indexOf(digit);return p>=0?ASCII_DIGITS[p]:digit;});
 if(!/^\+?[0-9\s().-]+$/.test(source))return null;
 const digits=source.replace(/[^0-9]/g,'');return digits.length>=8&&digits.length<=18?digits:null;
}
export function validateCustomerRegistration(input){
 if(!input||typeof input!=='object'||Array.isArray(input))return {ok:false,error:'INVALID_REGISTRATION'};
 const fullName=String(input.fullName??'').replace(/\s+/g,' ').trim(),phone=normalizeCustomerPhone(input.phone),password=String(input.password??'');
 if(fullName.length<2||fullName.length>70)return {ok:false,error:'INVALID_NAME'};
 if(!phone)return {ok:false,error:'INVALID_PHONE'};
 if(password.length<8||password.length>128)return {ok:false,error:'INVALID_PASSWORD'};
 return {ok:true,fullName,phone,password};
}
