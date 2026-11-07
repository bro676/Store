import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCustomerPhone, validateCustomerRegistration } from '../src/customer-auth.js';

test('normalizes international, local and Arabic phone digits and rejects invalid text',()=>{
 assert.equal(normalizeCustomerPhone('+963 936 123 456'),'963936123456');
 assert.equal(normalizeCustomerPhone('09(36)-123-456'),'963936123456');
 assert.equal(normalizeCustomerPhone('+963 936 123 456'),'963936123456');
 assert.equal(normalizeCustomerPhone('00963 936 123 456'),'963936123456');
 assert.equal(normalizeCustomerPhone('٠٩٣٦١٢٣٤٥٦'),'963936123456');
 assert.equal(normalizeCustomerPhone('abc0936123456'),null);assert.equal(normalizeCustomerPhone('1234'),null);
});

test('validates a phone and password without OTP fields',()=>{
 assert.deepEqual(validateCustomerRegistration({fullName:'  Ibrahem   Olabi ',phone:'+963 936 123 456',password:'strong-pass-123'}),{ok:true,fullName:'Ibrahem Olabi',phone:'963936123456',password:'strong-pass-123'});
 assert.equal(validateCustomerRegistration({fullName:'A',phone:'0936123456',password:'strong-pass-123'}).error,'INVALID_NAME');
 assert.equal(validateCustomerRegistration({fullName:'Test User',phone:'1234',password:'strong-pass-123'}).error,'INVALID_PHONE');
 assert.equal(validateCustomerRegistration({fullName:'Test User',phone:'0936123456',password:'short'}).error,'INVALID_PASSWORD');
});
